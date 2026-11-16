"""Admin -- Readiness Score Playbook v2.1 configuration and the verification desk.

Every number is editable here; every change is written to config_versions with
who, why, the old and the new value, applies forward only (no score ever drops
because of a change) and can be rolled back. A change with a future date waits
until the nightly job applies it.

GET/PUT  /v21/settings                 readiness + streak/SP settings  (?preview=1 on PUT = impact only)
GET/POST /v21/actions                  readiness points list           PUT /v21/actions/<key>
GET      /v21/sp-actions               Streak Points list              PUT /v21/sp-actions/<key>
GET/PUT  /v21/buckets                  Clarity / Skill / Proof per card (must add up to the earned max)
GET/PUT  /v21/bands                    completion bands
GET/POST /v21/grades                   grade conversion                DELETE /v21/grades/<id>
GET      /v21/config-log               change log                      POST /v21/config-log/<id>/rollback
GET      /v21/verifications            the queue                       POST /v21/verifications/<id>/decision
GET      /v21/students/<id>/cards      a student's cards + events
POST     /v21/students/<id>/correction recorded correction (reason required)
POST     /v21/students/<id>/transition close the card, open the next one
GET      /v21/overview                 queue, unlock rate, scores by card
"""
from portal.helpers.error_capture import capture_error
import datetime
import json
import uuid
from flask import jsonify, request
from flask_restx import Resource
from flask_jwt_extended import jwt_required, get_jwt_identity
from portal.models import db
from portal.helpers.sp import call_proc, call_proc_one
from portal.helpers.admin_auth import can, AREA_SCORE
from portal.helpers.audit import log_audit
from portal.helpers import readiness_v21 as rv
from . import ns, logger

R_KEYS = ('v21_enabled', 'earned_max', 'completion_max', 'monthly_cap', 'cap_months', 'unlock_score',
          'premium_score', 'boost_threshold', 'boost_bands', 'max_action_points', 'max_employer_points',
          'active_ready_days', 'verify_hours', 'escalate_hours', 'correction_approval_over', 'grace_days',
          'skill_card_months', 'promotion_on', 'pass_mark', 'ai_weight')
S_KEYS = ('streak_seconds', 'monthly_saves', 'pause_tokens_year', 'pause_days', 'exam_pause_cards',
          'exam_days_around', 'reminder_hours', 'quiet_from', 'quiet_to', 'weekly_reset_dow', 'multiplier_steps',
          'multiplier_on_bonus', 'levels', 'milestones', 'board_top_n')
JSON_KEYS = ('exam_pause_cards', 'reminder_hours', 'multiplier_steps', 'levels', 'milestones')
PILLARS = rv.PILLARS
LIMITS = ('once', 'per_card', 'per_month', 'each')
SP_LIMITS = ('daily', 'weekly', 'monthly', 'total', 'each')
CHECKERS = ('app', 'achiever', 'ops', 'employer', 'bhaai')


def _denied():
    return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)


def _bad(msg, status=400):
    return jsonify(response={'message': msg}, status=status, bool=False)


def _ok(data, status=200):
    return jsonify(response=data, status=status, bool=True)


def _err(where, e):
    db.session.rollback()
    logger.error(f"{where}: {e}")
    return jsonify(response={'message': 'Internal Server Error', 'error_id': capture_error(e)},
                   status=500, bool=False)


def _plain(v):
    if isinstance(v, (datetime.datetime, datetime.date)):
        return v.isoformat()
    if hasattr(v, 'is_integer'):                             # Decimal / float
        f = float(v)
        return int(f) if f.is_integer() else f
    return v


def _row(r):
    return {k: (rv._json(v, v) if k in JSON_KEYS + ('card_types', 'university_grades', 'old_value', 'new_value',
                                                    'impact', 'auto_check') else _plain(v))
            for k, v in (r or {}).items()}


def _settings_view():
    r = _row(rv.settings())
    s = _row(call_proc_one('sp_spv_settings_get'))
    return {'readiness': {k: r.get(k) for k in R_KEYS}, 'streak': {k: s.get(k) for k in S_KEYS},
            'versions': {'readiness': r.get('config_version'), 'streak': s.get('config_version')}}


def _log(area, key, old, new, reason, admin, effective=None, status='applied', impact=None):
    return call_proc_one('sp_rv_config_add', str(uuid.uuid4()), area, key, json.dumps(old, default=str),
                         json.dumps(new, default=str), reason, effective, status,
                         json.dumps(impact) if impact else None, admin)


def _impact(changes):
    """How many students a settings change touches, and what it does to pace."""
    cards = call_proc('sp_rv_active_cards', 100000, 0) or []
    out = {'active_cards': len(cards)}
    s = rv.settings()
    cap = changes.get('monthly_cap', s.get('monthly_cap'))
    months = changes.get('cap_months', s.get('cap_months'))
    unlock = changes.get('unlock_score', s.get('unlock_score'))
    if cap is not None and months is not None:
        out['max_by_end_of_cap_months'] = int(cap) * int(months)
        out['fastest_months_to_unlock'] = None if not int(cap) else -(-int(unlock or 60) // int(cap))
    return out


def _validate(sec, d):
    for k, v in d.items():
        if k in JSON_KEYS or k == 'promotion_on':
            continue
        try:
            f = float(v)
        except (TypeError, ValueError):
            return f'{k} must be a number.'
        if f < 0 or f > 100000:
            return f'{k} is out of range.'
    if sec == 'readiness':
        if 'promotion_on' in d and not (isinstance(d['promotion_on'], str) and len(d['promotion_on']) == 5):
            return 'Promotion date must look like 07-01.'
        if 'ai_weight' in d and not (0 <= float(d['ai_weight']) <= 1):
            return 'AI weight must be between 0 and 1.'
    return None


def apply_change(area, key, new, admin):
    """Write one config change. Used by save, scheduled changes and rollback."""
    if area == 'readiness_settings':
        call_proc_one('sp_rv_settings_set', json.dumps(new), admin)
    elif area == 'sp_settings':
        call_proc_one('sp_spv_settings_set', json.dumps(new), admin)
    elif area == 'score_actions':
        a = new
        call_proc_one('sp_rv_action_upsert', key, a['label'], a.get('evidence'), json.dumps(a['card_types']),
                      a['pillar'], int(a['points']), a.get('bonus_points'), a.get('bonus_min_mark'),
                      a['limit_type'], a.get('limit_value'), a['checked_by'], int(bool(a.get('is_employer'))),
                      a.get('sort_order'), int(bool(a.get('is_active', True))), admin)
    elif area == 'sp_actions':
        a = new
        call_proc_one('sp_spv_action_upsert', key, a['label'], int(a['points']), a['limit_type'],
                      a.get('limit_value'), int(bool(a.get('multiplier_applies', True))), a.get('sort_order'),
                      int(bool(a.get('is_active', True))), admin)
    elif area == 'buckets':
        for p, size in new.items():
            call_proc_one('sp_rv_bucket_set', key, p, int(size))
    elif area == 'correction':
        rv.correction(new['user_id'], new['card_id'], new['pillar'], int(new['points']),
                      'approved correction', admin)
    elif area == 'bands':
        b = new
        call_proc_one('sp_rv_band_set', key, b['label'], b.get('min_percent'), json.dumps(b['university_grades']),
                      int(b['points']), int(bool(b.get('is_pending'))), int(b['sort_order']))


def _save(area, key, old, new, reason, admin, effective):
    """Now -> apply + log 'applied'. Future date -> log 'approved', the job applies it."""
    when = None
    if effective:
        try:
            when = datetime.datetime.fromisoformat(str(effective)[:19])
        except ValueError:
            return None, 'Effective date is not valid.'
    if when and when > rv.utcnow():
        row = _log(area, key, old, new, reason, admin, when, 'approved')
        return row, None
    apply_change(area, key, new, admin)
    return _log(area, key, old, new, reason, admin), None


def _list(v):
    if isinstance(v, str):
        return [x.strip() for x in v.split(',') if x.strip()]
    return list(v or [])


def _reason(d):
    return (d.get('reason') or '').strip()[:500]


# ── settings ─────────────────────────────────────────────────────────────────

@ns.route('/v21/settings')
class AdminV21Settings(Resource):
    @jwt_required()
    def get(self):
        try:
            if not can(AREA_SCORE):
                return _denied()
            return _ok(_settings_view())
        except Exception as e:
            return _err('GET /admin/v21/settings', e)

    @jwt_required()
    def put(self):
        try:
            if not can(AREA_SCORE):
                return _denied()
            d = request.get_json() or {}
            admin = get_jwt_identity()
            cur = _settings_view()
            r_new = {k: v for k, v in (d.get('readiness') or {}).items() if k in R_KEYS and v != cur['readiness'].get(k)}
            s_new = {k: v for k, v in (d.get('streak') or {}).items() if k in S_KEYS and v != cur['streak'].get(k)}
            if request.args.get('preview'):
                return _ok({'impact': _impact(r_new)})
            if not r_new and not s_new:
                return _bad('Nothing changed.')
            err = _validate('readiness', r_new) or _validate('streak', s_new)
            if err:
                return _bad(err)
            if not _reason(d):
                return _bad('Add a reason for this change.')
            for area, new, old in (('readiness_settings', r_new, cur['readiness']), ('sp_settings', s_new, cur['streak'])):
                if new:
                    _, err = _save(area, None, {k: old.get(k) for k in new}, new, _reason(d), admin,
                                   d.get('effective_from'))
                    if err:
                        db.session.rollback()
                        return _bad(err)
            db.session.commit()
            log_audit('readiness_v21_settings', 'readiness_settings', '1', admin, {'readiness': r_new, 'streak': s_new})
            return _ok({**_settings_view(), 'message': 'Settings saved.'})
        except Exception as e:
            return _err('PUT /admin/v21/settings', e)


@ns.route('/v21/settings/<string:section>')
class AdminV21SettingsSection(Resource):
    """Flat settings for one section (readiness | streak), shaped for SettingsCard."""
    @jwt_required()
    def get(self, section):
        try:
            if not can(AREA_SCORE):
                return _denied()
            if section not in ('readiness', 'streak'):
                return _bad('Unknown section.', 404)
            return _ok({'settings': {**_settings_view()[section], 'reason': ''}})
        except Exception as e:
            return _err('GET /admin/v21/settings/section', e)

    @jwt_required()
    def put(self, section):
        try:
            if not can(AREA_SCORE):
                return _denied()
            if section not in ('readiness', 'streak'):
                return _bad('Unknown section.', 404)
            d = request.get_json() or {}
            keys = R_KEYS if section == 'readiness' else S_KEYS
            cur = _settings_view()[section]
            new = {k: d[k] for k in keys if k in d and d[k] is not None and d[k] != cur.get(k)}
            if not new:
                return _bad('Nothing changed.')
            err = _validate(section, new)
            if err:
                return _bad(err)
            if not _reason(d):
                return _bad('Add a reason for this change.')
            area = 'readiness_settings' if section == 'readiness' else 'sp_settings'
            _, err = _save(area, None, {k: cur.get(k) for k in new}, new, _reason(d), get_jwt_identity(),
                           d.get('effective_from'))
            if err:
                db.session.rollback()
                return _bad(err)
            db.session.commit()
            log_audit('readiness_v21_settings', area, '1', get_jwt_identity(), new)
            return _ok({'settings': {**_settings_view()[section], 'reason': ''}, 'message': 'Settings saved.'})
        except Exception as e:
            return _err('PUT /admin/v21/settings/section', e)


# ── readiness points list ────────────────────────────────────────────────────

def _action_in(d, key=None):
    a = {'label': (d.get('label') or '').strip()[:160], 'evidence': (d.get('evidence') or '').strip()[:255] or None,
         'card_types': [c for c in _list(d.get('card_types')) if c in rv.CARD_ORDER], 'pillar': d.get('pillar'),
         'points': d.get('points'), 'bonus_points': d.get('bonus_points') or None,
         'bonus_min_mark': d.get('bonus_min_mark') or None, 'limit_type': d.get('limit_type'),
         'limit_value': d.get('limit_value') if d.get('limit_type') != 'each' else None,
         'checked_by': d.get('checked_by'), 'is_employer': bool(d.get('is_employer')),
         'sort_order': d.get('sort_order'), 'is_active': d.get('is_active', True)}
    s = rv.settings()
    top = rv._int(s.get('max_employer_points'), 8) if a['is_employer'] else rv._int(s.get('max_action_points'), 5)
    if not a['label'] or not a['card_types']:
        return a, 'Give the action a name and at least one card.'
    if a['pillar'] not in PILLARS or a['limit_type'] not in LIMITS or a['checked_by'] not in CHECKERS:
        return a, 'Choose a pillar, a limit and who checks it.'
    if rv._int(a['points'], -1) < 1 or rv._int(a['points']) > top:
        return a, f'Points must be between 1 and {top}.'
    if a['bonus_points'] is not None and not (rv._int(a['points']) < rv._int(a['bonus_points']) <= top):
        return a, f'Bonus points must be above the points and at most {top}.'
    if a['limit_type'] != 'each' and rv._int(a['limit_value'], 0) < 1:
        return a, 'Set how many times it can count.'
    return a, None


def _action_out(r):
    r = _row(r)
    return {k: r.get(k) for k in ('action_key', 'label', 'evidence', 'card_types', 'pillar', 'points', 'bonus_points',
                                  'bonus_min_mark', 'limit_type', 'limit_value', 'checked_by', 'is_employer',
                                  'sort_order', 'is_active')}


@ns.route('/v21/actions')
class AdminV21Actions(Resource):
    @jwt_required()
    def get(self):
        try:
            if not can(AREA_SCORE):
                return _denied()
            rows = call_proc('sp_rv_actions_list', request.args.get('card'), 0) or []
            def label(cards):
                cards = _list(cards)
                if set(cards) >= set(rv.CARD_ORDER):
                    return 'All cards'
                return ', '.join(rv.CARD_LABELS.get(c, c) for c in cards)
            return _ok({'actions': [{**_action_out(r), 'card_types': ','.join(_list(_action_out(r)['card_types'])),
                                     'cards_label': label(_action_out(r)['card_types'])} for r in rows]})
        except Exception as e:
            return _err('GET /admin/v21/actions', e)

    @jwt_required()
    def post(self):
        try:
            if not can(AREA_SCORE):
                return _denied()
            d = request.get_json() or {}
            key = ''.join(ch for ch in (d.get('action_key') or d.get('label') or '').lower().replace(' ', '_')
                          if ch.isalnum() or ch == '_')[:50]
            if not key:
                return _bad('Give the action a name.')
            if call_proc_one('sp_rv_action_get', key) or call_proc_one('sp_spv_action_get', key):
                return _bad('An action with this key already exists (in readiness or Streak Points).', 409)
            a, err = _action_in(d)
            if err:
                return _bad(err)
            _, err = _save('score_actions', key, None, a, _reason(d) or 'new action', get_jwt_identity(),
                           d.get('effective_from'))
            if err:
                return _bad(err)
            db.session.commit()
            return _ok({'action': _action_out(call_proc_one('sp_rv_action_get', key)), 'message': 'Action added.'}, 201)
        except Exception as e:
            return _err('POST /admin/v21/actions', e)


@ns.route('/v21/actions/<string:key>')
class AdminV21Action(Resource):
    @jwt_required()
    def put(self, key):
        try:
            if not can(AREA_SCORE):
                return _denied()
            old = call_proc_one('sp_rv_action_get', key)
            if not old:
                return _bad('Action not found.', 404)
            d = request.get_json() or {}
            a, err = _action_in({**_action_out(old), **d})
            if err:
                return _bad(err)
            if not _reason(d):
                return _bad('Add a reason for this change.')
            _, err = _save('score_actions', key, _action_out(old), a, _reason(d), get_jwt_identity(),
                           d.get('effective_from'))
            if err:
                return _bad(err)
            db.session.commit()
            return _ok({'action': _action_out(call_proc_one('sp_rv_action_get', key)), 'message': 'Action saved.'})
        except Exception as e:
            return _err('PUT /admin/v21/actions', e)


# ── Streak Points list ───────────────────────────────────────────────────────

def _sp_out(r):
    r = _row(r)
    return {k: r.get(k) for k in ('sp_action', 'label', 'points', 'limit_type', 'limit_value', 'multiplier_applies',
                                  'sort_order', 'is_active')}


@ns.route('/v21/sp-actions')
class AdminV21SpActions(Resource):
    @jwt_required()
    def get(self):
        try:
            if not can(AREA_SCORE):
                return _denied()
            return _ok({'actions': [_sp_out(r) for r in call_proc('sp_spv_actions_list') or []]})
        except Exception as e:
            return _err('GET /admin/v21/sp-actions', e)


@ns.route('/v21/sp-actions/<string:key>')
class AdminV21SpAction(Resource):
    @jwt_required()
    def put(self, key):
        try:
            if not can(AREA_SCORE):
                return _denied()
            old = call_proc_one('sp_spv_action_get', key)
            if not old:
                return _bad('Activity not found.', 404)
            d = request.get_json() or {}
            a = {**_sp_out(old), **{k: d[k] for k in ('label', 'points', 'limit_type', 'limit_value',
                                                      'multiplier_applies', 'is_active') if k in d}}
            if rv._int(a['points'], -1) < 0 or rv._int(a['points']) > 10000 or a['limit_type'] not in SP_LIMITS:
                return _bad('Points must be 0–10,000 with a valid limit.')
            if a['limit_type'] != 'each' and rv._int(a.get('limit_value'), 0) < 1:
                return _bad('Set how many times it can count.')
            if not _reason(d):
                return _bad('Add a reason for this change.')
            _, err = _save('sp_actions', key, _sp_out(old), a, _reason(d), get_jwt_identity(), d.get('effective_from'))
            if err:
                return _bad(err)
            db.session.commit()
            return _ok({'action': _sp_out(call_proc_one('sp_spv_action_get', key)), 'message': 'Activity saved.'})
        except Exception as e:
            return _err('PUT /admin/v21/sp-actions', e)


# ── buckets, bands, grade conversion ─────────────────────────────────────────

@ns.route('/v21/buckets')
class AdminV21Buckets(Resource):
    @jwt_required()
    def get(self):
        try:
            if not can(AREA_SCORE):
                return _denied()
            by = {c: {'card_type': c, 'label': rv.CARD_LABELS[c], 'clarity': 0, 'skill': 0, 'proof': 0}
                  for c in rv.CARD_ORDER}
            for r in call_proc('sp_rv_buckets_list') or []:
                if r['card_type'] in by:
                    by[r['card_type']][r['pillar']] = int(r['bucket_size'])
            rows = [{**b, 'total': b['clarity'] + b['skill'] + b['proof']} for b in by.values()]
            return _ok({'buckets': rows, 'earned_max': rv._int(rv.settings().get('earned_max'), 70)})
        except Exception as e:
            return _err('GET /admin/v21/buckets', e)


@ns.route('/v21/buckets/<string:card>')
class AdminV21Bucket(Resource):
    @jwt_required()
    def put(self, card):
        try:
            if not can(AREA_SCORE):
                return _denied()
            d = request.get_json() or {}
            total = rv._int(rv.settings().get('earned_max'), 70)
            sizes = {p: rv._int(d.get(p), -1) for p in PILLARS}
            if card not in rv.CARD_ORDER or any(v < 0 for v in sizes.values()):
                return _bad('Give a size for Clarity, Skill and Proof.')
            if sum(sizes.values()) != total:
                return _bad(f'The three buckets must add up to {total}.')
            if not _reason(d):
                return _bad('Add a reason for this change.')
            old = {r['pillar']: int(r['bucket_size']) for r in call_proc('sp_rv_buckets_list') or []
                   if r['card_type'] == card}
            _, err = _save('buckets', card, old, sizes, _reason(d), get_jwt_identity(), d.get('effective_from'))
            if err:
                return _bad(err)
            db.session.commit()
            return _ok({'message': 'Buckets saved. Points already earned stay; new work fills the new sizes.'})
        except Exception as e:
            return _err('PUT /admin/v21/buckets', e)


@ns.route('/v21/bands')
class AdminV21Bands(Resource):
    @jwt_required()
    def get(self):
        try:
            if not can(AREA_SCORE):
                return _denied()
            return _ok({'bands': [{**_row(b), 'university_grades': ','.join(_row(b).get('university_grades') or [])}
                                  for b in call_proc('sp_rv_bands_list') or []]})
        except Exception as e:
            return _err('GET /admin/v21/bands', e)



@ns.route('/v21/bands/<string:band>')
class AdminV21Band(Resource):
    @jwt_required()
    def put(self, band):
        try:
            if not can(AREA_SCORE):
                return _denied()
            d = request.get_json() or {}
            if 'university_grades' in d:
                d['university_grades'] = _list(d['university_grades'])
            old = next((_row(b) for b in call_proc('sp_rv_bands_list') or [] if b['band'] == band), None)
            if not old:
                return _bad('Band not found.', 404)
            new = {**old, **{k: d[k] for k in ('label', 'min_percent', 'university_grades', 'points') if k in d}}
            if not (0 <= rv._int(new['points'], -1) <= rv._int(rv.settings().get('completion_max'), 30)):
                return _bad('Points must be between 0 and the completion maximum.')
            if not _reason(d):
                return _bad('Add a reason for this change.')
            _, err = _save('bands', band, old, new, _reason(d), get_jwt_identity(), d.get('effective_from'))
            if err:
                return _bad(err)
            db.session.commit()
            return _ok({'message': 'Band saved.'})
        except Exception as e:
            return _err('PUT /admin/v21/bands', e)


@ns.route('/v21/grades')
class AdminV21Grades(Resource):
    @jwt_required()
    def get(self):
        try:
            if not can(AREA_SCORE):
                return _denied()
            return _ok({'grades': [_row(g) for g in call_proc('sp_rv_grades_list') or []]})
        except Exception as e:
            return _err('GET /admin/v21/grades', e)

    @jwt_required()
    def post(self):
        try:
            if not can(AREA_SCORE):
                return _denied()
            d = request.get_json() or {}
            board, raw, band = (d.get('board_or_university') or '').strip(), (d.get('raw_grade') or '').strip(), d.get('band')
            if not board or not raw or band not in [b['band'] for b in call_proc('sp_rv_bands_list') or []]:
                return _bad('Give the board or university, the grade and its band.')
            row = call_proc_one('sp_rv_grade_upsert', str(uuid.uuid4()), board[:120], raw[:30], band)
            db.session.commit()
            log_audit('readiness_v21_grade', 'grade_conversion', row.get('id'), get_jwt_identity(), d)
            return _ok({'grade': _row(row), 'message': 'Grade saved.'}, 201)
        except Exception as e:
            return _err('POST /admin/v21/grades', e)


@ns.route('/v21/grades/<string:gid>')
class AdminV21Grade(Resource):
    @jwt_required()
    def delete(self, gid):
        try:
            if not can(AREA_SCORE):
                return _denied()
            call_proc_one('sp_rv_grade_delete', gid)
            db.session.commit()
            return _ok({'message': 'Grade removed.'})
        except Exception as e:
            return _err('DELETE /admin/v21/grades', e)


# ── change log + rollback ────────────────────────────────────────────────────

@ns.route('/v21/config-log')
class AdminV21ConfigLog(Resource):
    @jwt_required()
    def get(self):
        try:
            if not can(AREA_SCORE):
                return _denied()
            rows = call_proc('sp_rv_config_list', request.args.get('area'), request.args.get('status'), 200) or []
            return _ok({'changes': [_row(r) for r in rows]})
        except Exception as e:
            return _err('GET /admin/v21/config-log', e)


@ns.route('/v21/config-log/<string:cid>/rollback')
class AdminV21Rollback(Resource):
    @jwt_required()
    def post(self, cid):
        try:
            if not can(AREA_SCORE):
                return _denied()
            row = _row(call_proc_one('sp_rv_config_get', cid))
            if not row or row.get('status') not in ('applied', 'approved'):
                return _bad('Only an applied or scheduled change can be rolled back.', 409)
            admin = get_jwt_identity()
            if row['status'] == 'applied':
                if row.get('old_value') is None:
                    return _bad('A new action cannot be rolled back; switch it off instead.', 409)
                apply_change(row['area'], row.get('item_key'), row['old_value'], admin)
                _log(row['area'], row.get('item_key'), row['new_value'], row['old_value'],
                     f"rollback of {cid}", admin)
            call_proc_one('sp_rv_config_decide', cid, 'rolled_back', admin)
            db.session.commit()
            return _ok({'message': 'Change rolled back.'})
        except Exception as e:
            return _err('POST /admin/v21/config-log/rollback', e)


@ns.route('/v21/config-log/<string:cid>/approve')
class AdminV21Approve(Resource):
    @jwt_required()
    def post(self, cid):
        try:
            if not can(AREA_SCORE):
                return _denied()
            row = _row(call_proc_one('sp_rv_config_get', cid))
            admin = get_jwt_identity()
            if not row or row.get('status') != 'pending':
                return _bad('Only a pending change can be approved.', 409)
            if row.get('created_by') == admin:
                return _bad('A second admin must approve this change.', 403)
            if (request.get_json(silent=True) or {}).get('decision') == 'reject':
                call_proc_one('sp_rv_config_decide', cid, 'rejected', admin)
            else:
                apply_change(row['area'], row.get('item_key'), row['new_value'], admin)
                call_proc_one('sp_rv_config_decide', cid, 'applied', admin)
            db.session.commit()
            return _ok({'message': 'Decision saved.'})
        except Exception as e:
            return _err('POST /admin/v21/config-log/approve', e)


def apply_scheduled(now=None):
    """Nightly: apply approved changes whose date has arrived."""
    n = 0
    for r in call_proc('sp_rv_config_due', now or rv.utcnow()) or []:
        r = _row(r)
        apply_change(r['area'], r.get('item_key'), r['new_value'], r.get('created_by'))
        call_proc_one('sp_rv_config_decide', r['id'], 'applied', r.get('created_by'))
        n += 1
    return n


# ── verification desk ────────────────────────────────────────────────────────

@ns.route('/v21/verifications')
class AdminV21Queue(Resource):
    @jwt_required()
    def get(self):
        try:
            if not can(AREA_SCORE):
                return _denied()
            a = request.args
            rows = call_proc('sp_rv_verif_queue', a.get('status', 'pending'), a.get('route'), a.get('kind'),
                             rv._int(a.get('limit'), 50), rv._int(a.get('offset'), 0)) or []
            counts = call_proc('sp_rv_verif_count') or []
            return _ok({'requests': [_row(r) for r in rows], 'counts': [_row(c) for c in counts],
                        'bands': [_row(b) for b in call_proc('sp_rv_bands_list') or []]})
        except Exception as e:
            return _err('GET /admin/v21/verifications', e)


@ns.route('/v21/verifications/<string:rid>/decision')
class AdminV21Decision(Resource):
    @jwt_required()
    def post(self, rid):
        try:
            if not can(AREA_SCORE):
                return _denied()
            d = request.get_json() or {}
            approve = d.get('decision') == 'approve'
            if not approve and not (d.get('reason') or '').strip():
                return _bad('Choose a reason for rejecting.')
            mark = d.get('mark')
            if mark is not None and not (0 <= rv._int(mark, -1) <= 10):
                return _bad('Mark must be 0–10.')
            res = rv.decide(rid, approve, get_jwt_identity(), mark=None if mark is None else rv._int(mark),
                            feedback=(d.get('feedback') or '').strip()[:500] or None,
                            reason=(d.get('reason') or '').strip()[:255] or None, band=d.get('band'))
            msgs = {'not_found': ('Request not found.', 404), 'already_decided': ('Already decided.', 409),
                    'mark_required': ('Give a mark out of 10.', 400), 'band_required': ('Choose the result band.', 400)}
            if res['result'] in msgs:
                return _bad(*msgs[res['result']])
            db.session.commit()
            log_audit('readiness_v21_decision', 'verification_requests', rid, get_jwt_identity(), d)
            return _ok({**res, 'message': 'Approved.' if res['result'] == 'approved' else 'Rejected.'})
        except Exception as e:
            return _err('POST /admin/v21/verifications/decision', e)


# ── a student's cards ────────────────────────────────────────────────────────

@ns.route('/v21/students/<string:uid>/cards')
class AdminV21StudentCards(Resource):
    @jwt_required()
    def get(self, uid):
        try:
            if not can(AREA_SCORE):
                return _denied()
            cards = call_proc('sp_rv_cards_for_user', uid) or []
            return _ok({'index': _row(call_proc_one('sp_rv_index_get', uid)),
                        'cards': [{**rv.card_view(c), 'pillars': rv.pillar_state(c) if c['card_type'] else {},
                                   'events': rv.history(c['id'], 50)} for c in cards]})
        except Exception as e:
            return _err('GET /admin/v21/students/cards', e)


@ns.route('/v21/students/<string:uid>/correction')
class AdminV21Correction(Resource):
    @jwt_required()
    def post(self, uid):
        try:
            if not can(AREA_SCORE):
                return _denied()
            d = request.get_json() or {}
            pts = rv._int(d.get('points'), 0)
            if not pts or not (d.get('reason') or '').strip():
                return _bad('Give the points and a written reason.')
            over = rv._int(rv.settings().get('correction_approval_over'), 10)
            if abs(pts) > over:
                # Large corrections wait in the change log for a second admin (the founder) to approve.
                new = {'user_id': uid, 'card_id': d.get('card_id'), 'pillar': d.get('pillar'), 'points': pts}
                _log('correction', uid, None, new, d['reason'].strip()[:500], get_jwt_identity(), None, 'pending')
                db.session.commit()
                return _ok({'message': f'Corrections over {over} points need approval. Sent for approval.'}, 202)
            res = rv.correction(uid, d.get('card_id'), d.get('pillar'), pts, d['reason'].strip()[:255],
                                get_jwt_identity())
            if res['result'] != 'applied':
                return _bad('Choose the card and pillar.')
            db.session.commit()
            log_audit('readiness_v21_correction', 'student_stages', d.get('card_id'), get_jwt_identity(), d)
            return _ok({'message': 'Correction recorded.'})
        except Exception as e:
            return _err('POST /admin/v21/students/correction', e)


@ns.route('/v21/students/<string:uid>/transition')
class AdminV21Transition(Resource):
    @jwt_required()
    def post(self, uid):
        try:
            if not can(AREA_SCORE):
                return _denied()
            d = request.get_json() or {}
            res = rv.transition(uid, d.get('card_type'), get_jwt_identity(), (d.get('reason') or 'admin move')[:255])
            if res['result'] != 'opened':
                return _bad('Choose the next card.')
            db.session.commit()
            log_audit('readiness_v21_transition', 'student_stages', res.get('card_id'), get_jwt_identity(), d)
            return _ok({**res, 'message': 'New card opened.'})
        except Exception as e:
            return _err('POST /admin/v21/students/transition', e)


@ns.route('/v21/overview')
class AdminV21Overview(Resource):
    @jwt_required()
    def get(self):
        try:
            if not can(AREA_SCORE):
                return _denied()
            s = rv.settings()
            unlock = rv._int(s.get('unlock_score'), 60)
            by_card = {}
            offset = 0
            while True:
                rows = call_proc('sp_rv_active_cards', 1000, offset) or []
                if not rows:
                    break
                for c in rows:
                    card = call_proc_one('sp_rv_card_get', c['id']) or {}
                    b = by_card.setdefault(c['card_type'], {'students': 0, 'unlocked': 0, 'earned_total': 0})
                    b['students'] += 1
                    e = float(card.get('earned_score') or 0)
                    b['earned_total'] += e
                    b['unlocked'] += 1 if e >= unlock else 0
                offset += len(rows)
            for b in by_card.values():
                b['avg_earned'] = round(b.pop('earned_total') / b['students'], 1) if b['students'] else 0
            return _ok({'by_card': by_card, 'queue': [_row(c) for c in call_proc('sp_rv_verif_count') or []],
                        'enabled': bool(s.get('v21_enabled'))})
        except Exception as e:
            return _err('GET /admin/v21/overview', e)
