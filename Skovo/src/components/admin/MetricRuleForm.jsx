/**
 * Build a scoring rule out of something the platform already records.
 *
 * WHY THIS REPLACED A TEXT BOX
 *   An action used to be an event key typed by hand, which had to match an
 *   award() call in the product. Type a key nothing fires and you got a row
 *   that listed, looked wired, and silently never paid -- and only 15 keys
 *   existed, so "Pro annual is worth 20 points" was a code change.
 *
 *   Here the admin picks a fact instead. The key is derived server-side, so
 *   the typo failure mode is gone, and the catalogue covers the product rather
 *   than fifteen hardcoded strings.
 *
 * ONE FORM, EVERY SHAPE
 *   A rule is one of three things, chosen at the top:
 *
 *     One thing      a metric and a test -- each time, reaches N, every N,
 *                    when it starts, tiered, a streak
 *     All of these   several conditions, pays once when every one is met
 *     Any of these   the same, but N of them is enough
 *
 *   Everything after that point is shared: points, a cap, who it applies to,
 *   when it runs, whether the points lapse. The admin never chooses between an
 *   "instant" and a "nightly" rule -- the engine decides that, and a combo
 *   pays the moment its last condition lands either way.
 *
 * NOTHING IS SAVED BLIND
 *   The preview runs as you type and says how many students this matches and
 *   what it would cost, before you commit. "Apply to existing students" is off
 *   by default: there are hundreds of students with cohorts and documents
 *   already in those tables, and a careless save must not move all of them.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Plus, Save, Trash2, X } from 'lucide-react';
import { Button, FormSelect } from '../ui/index.jsx';
import DatePicker from '../ui/DatePicker';
import { adminApi as api, api as publicApi } from '../../services/api';
import { useMasters } from '../../hooks/useMasters';

// Which tests a metric offers, and their labels, come from
// master_score_rule_test (Admin > Masters): the API sends a metric's own
// `tests` plus `extra_tests`, the ones any metric can take. These two values
// only decide which extra fields the form shows and how it is saved -- logic,
// not an option list.
const SHAPED_TESTS = ['tiered', 'streak'];

const NEEDS_THRESHOLD = new Set(['reaches', 'every']);

const SHAPES = [
  { value: 'simple', label: 'One thing',     hint: 'A single action, measured' },
  { value: 'all_of', label: 'All of these',  hint: 'Pays once, when every one is done' },
  { value: 'any_of', label: 'Any of these',  hint: 'Pays once, when enough are done' },
];

const EMPTY = {
  shape: 'simple',
  metric_key: '', metric_filter: '', rule_test: '',
  threshold: '', points: '5', cap_value: '', backfill: false, label: '',
  tier_points: '', streak_days: '',
  until_at: '', expires_days: '',
  segment_education: '', segment_degree: '', segment_state: '',
  require_count: '2',
  conditions: [{ metric_key: '', metric_filter: '', threshold: '1' }],
};

const field = 'w-full min-h-11 px-3 border border-slate-200 rounded-xl text-sm';
// Small number boxes. Not `${field} w-20`: field's w-full won that fight, so
// the box stretched and squeezed its label onto three lines on a phone.
const numField = 'w-20 shrink-0 min-h-11 px-3 border border-slate-200 rounded-xl text-sm text-center';

export default function MetricRuleForm({ metrics = [], onSaved, onCancel, flash }) {
  const [form, setForm] = useState(EMPTY);
  const [preview, setPreview] = useState(null);
  const [saving, setSaving] = useState(false);
  const [more, setMore] = useState(false);

  const combo = form.shape !== 'simple';
  const meta = metrics.find((m) => m.value === form.metric_key) || null;
  const tests = meta ? [...new Set([...(meta.tests || []), ...(meta.extra_tests || [])])] : [];
  const { lists } = useMasters(['score_rule_test', 'onboarding_category']);

  // "Only these students" must offer exactly the values a profile stores —
  // sp_score_segment_filter compares them as-is, so a typed "Telengana" or
  // "class 10" matched nobody, silently. Class from the onboarding_category
  // master, degree from the course catalogue, state from the states table.
  const [segDegrees, setSegDegrees] = useState([]);
  const [segStates, setSegStates] = useState([]);
  useEffect(() => {
    api.get('/skovo-platform-panel-admin/course-catalogue')
      .then(({ data }) => { if (data?.bool) setSegDegrees(data.response.categories || []); })
      .catch(() => {});
    publicApi.get('/auth/states')
      .then(({ data }) => { if (data?.bool) setSegStates((data.response.states || []).map(s => s.name)); })
      .catch(() => {});
  }, []);
  const segClassOptions = (lists.onboarding_category || [])
    .map(o => ({ value: o.value, label: String(o.label || o.value).split('|')[0] }));
  const testLabel = Object.fromEntries((lists.score_rule_test || []).map((t) => [t.value, t.label]));
  const needsThreshold = NEEDS_THRESHOLD.has(form.rule_test);
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const filledConditions = form.conditions.filter((c) => c.metric_key);

  const ready = combo
    ? Boolean(form.label.trim() && filledConditions.length > 0 && form.points !== ''
        && (form.shape !== 'any_of' || Number(form.require_count) >= 1))
    : Boolean(form.metric_key && form.rule_test && form.points !== ''
        && (!needsThreshold || Number(form.threshold) >= 1)
        && (form.rule_test !== 'tiered' || form.tier_points.trim())
        && (form.rule_test !== 'streak' || Number(form.streak_days) >= 2));

  // Changing the metric can invalidate the test and the filter, so they reset
  // rather than silently carrying over something the new metric rejects.
  const pickMetric = (v) => {
    const m = metrics.find((x) => x.value === v);
    const only = [...(m?.tests || []), ...(m?.extra_tests || [])];
    setForm((f) => ({
      ...f, metric_key: v || '', metric_filter: '',
      rule_test: only.length === 1 ? only[0] : '',
      threshold: '', tier_points: '', streak_days: '',
    }));
  };

  const setCondition = (i, patch) => setForm((f) => ({
    ...f,
    conditions: f.conditions.map((c, n) => (n === i ? { ...c, ...patch } : c)),
  }));
  const addCondition = () => setForm((f) => ({
    ...f, conditions: [...f.conditions, { metric_key: '', metric_filter: '', threshold: '1' }],
  }));
  const dropCondition = (i) => setForm((f) => ({
    ...f,
    conditions: f.conditions.length > 1
      ? f.conditions.filter((_, n) => n !== i)
      : f.conditions,
  }));

  // Only the simple shapes can be previewed: the preview procedure measures one
  // metric, and a combo is several. Rather than show a number that means
  // something else, a combo shows nothing and the save reports what it moved.
  const runPreview = useCallback(() => {
    // No setState on the way out: a stale preview is hidden at render instead
    // (see `shownPreview`), which keeps this effect free of cascading renders.
    if (combo || !ready) return undefined;
    let alive = true;
    const t = setTimeout(async () => {
      try {
        const { data } = await api.post(
          '/skovo-platform-panel-admin/score-rules/metric-rule/preview',
          {
            metric_key: form.metric_key,
            metric_filter: form.metric_filter || undefined,
            // tiered and streak have no preview of their own; 'each' is the
            // closest honest answer for how many students the metric matches.
            rule_test: SHAPED_TESTS.includes(form.rule_test) ? 'each' : form.rule_test,
            threshold: needsThreshold ? Number(form.threshold) : undefined,
            points: Number(form.points) || 0,
            cap_value: form.cap_value ? Number(form.cap_value) : undefined,
            backfill: form.backfill,
          },
        );
        if (alive) setPreview(data?.bool ? data.response : null);
      } catch { if (alive) setPreview(null); }
    }, 300);
    return () => { alive = false; clearTimeout(t); };
  }, [combo, ready, needsThreshold, form]);

  useEffect(runPreview, [runPreview]);

  // Whatever the last request returned is only meaningful while the form still
  // describes a previewable rule.
  const shownPreview = (!combo && ready) ? preview : null;

  const save = async () => {
    if (!ready || saving) return;
    setSaving(true);
    const shared = {
      points: Number(form.points),
      label: form.label.trim() || undefined,
      backfill: form.backfill,
      is_active: true,
      until_at: form.until_at || undefined,
      expires_days: form.expires_days ? Number(form.expires_days) : undefined,
      segment_education: form.segment_education || undefined,
      segment_degree: form.segment_degree || undefined,
      segment_state: form.segment_state || undefined,
    };
    // A plain "each / reaches / every / when it starts" rule keeps going to the
    // endpoint that validates the metric-and-test pairing. Everything the older
    // endpoint cannot express goes to the shaped one.
    const plain = !combo && !SHAPED_TESTS.includes(form.rule_test)
      && !form.until_at && !form.expires_days
      && !form.segment_education && !form.segment_degree && !form.segment_state;
    const url = plain
      ? '/skovo-platform-panel-admin/score-rules/metric-rule'
      : '/skovo-platform-panel-admin/score-rules/shaped-rule';

    const body = combo
      ? {
          ...shared, shape: form.shape,
          require_count: form.shape === 'any_of' ? Number(form.require_count) : undefined,
          conditions: filledConditions.map((c) => ({
            metric_key: c.metric_key,
            metric_filter: c.metric_filter || undefined,
            threshold: Number(c.threshold) || 1,
          })),
        }
      : {
          ...shared, shape: 'simple',
          metric_key: form.metric_key,
          metric_filter: form.metric_filter || undefined,
          rule_test: form.rule_test,
          threshold: needsThreshold ? Number(form.threshold) : undefined,
          tier_points: form.rule_test === 'tiered' ? form.tier_points.trim() : undefined,
          streak_days: form.rule_test === 'streak' ? Number(form.streak_days) : undefined,
          cap_type: form.cap_value ? 'lifetime' : 'none',
          cap_value: form.cap_value ? Number(form.cap_value) : undefined,
        };

    try {
      const { data } = await api.post(url, body);
      if (data?.bool) { flash?.(data.response.message); setForm(EMPTY); onSaved?.(); }
      else flash?.(data?.response?.message || 'Could not save the rule.', 'error');
    } catch {
      flash?.('Could not save the rule.', 'error');
    } finally { setSaving(false); }
  };

  const metricOptions = metrics.map((m) => ({ value: m.value, label: m.label }));

  return (
    <div className="mt-4 pt-4 border-t border-slate-100 space-y-3">

      {/* ── what kind of rule ─────────────────────────────────────────── */}
      <div>
        <label className="block text-xs font-semibold text-slate-500 mb-1">How it works</label>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {SHAPES.map((s) => (
            <button
              key={s.value} type="button"
              onClick={() => set({ shape: s.value })}
              className={`min-h-11 px-3 py-2 rounded-xl border text-left transition-colors ${
                form.shape === s.value
                  ? 'border-violet-400 bg-violet-50 dark:bg-violet-500/10'
                  : 'border-slate-200 hover:border-slate-300'}`}
            >
              <span className="block text-sm font-semibold text-slate-700">{s.label}</span>
              <span className="block text-xs text-slate-400">{s.hint}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ── one thing ─────────────────────────────────────────────────── */}
      {!combo && (
        <>
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">What the student does</label>
            <FormSelect
              value={form.metric_key}
              onChange={pickMetric}
              options={metricOptions}
              searchType="score_metric"
              placeholder="Pick a metric"
              clearable={false}
            />
            {meta?.description && (
              <p className="mt-1 text-xs text-slate-400">{meta.description}</p>
            )}
          </div>

          {meta?.filter_values?.length > 0 && (
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">
                {meta.filter_label || 'Which one'}
              </label>
              <FormSelect
                value={form.metric_filter}
                onChange={(v) => set({ metric_filter: v || '' })}
                options={[
                  { value: '', label: `Any ${(meta.filter_label || 'value').toLowerCase()}` },
                  ...meta.filter_values.map((v) => ({ value: v, label: v })),
                ]}
                clearable={false}
              />
            </div>
          )}

          {meta && (
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">When it pays</label>
              <div className="flex flex-col sm:flex-row gap-2">
                <div className="flex-1 min-w-0">
                  <FormSelect
                    value={form.rule_test}
                    onChange={(v) => set({ rule_test: v || '', threshold: '', tier_points: '', streak_days: '' })}
                    options={tests.map((t) => ({ value: t, label: testLabel[t] || t }))}
                    placeholder="Pick when"
                    clearable={false}
                  />
                </div>
                {needsThreshold && (
                  <input
                    type="number" min="1" value={form.threshold}
                    onChange={(e) => set({ threshold: e.target.value })}
                    placeholder="20" aria-label="Target number"
                    className={`${field} sm:w-28 shrink-0 text-center`}
                  />
                )}
                {form.rule_test === 'streak' && (
                  <input
                    type="number" min="2" value={form.streak_days}
                    onChange={(e) => set({ streak_days: e.target.value })}
                    placeholder="7" aria-label="Days in a row"
                    className={`${field} sm:w-28 shrink-0 text-center`}
                  />
                )}
              </div>
            </div>
          )}

          {form.rule_test === 'tiered' && (
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">
                Worth, in order
              </label>
              <input
                value={form.tier_points}
                onChange={(e) => set({ tier_points: e.target.value })}
                placeholder="5,3,1" aria-label="Points for the first, second, third"
                className={field}
              />
              <p className="mt-1 text-xs text-slate-400">
                <strong>5,3,1</strong> &mdash; the first is worth 5, the second 3, the
                third and after 1. End with <strong>0</strong> to stop paying instead.
              </p>
            </div>
          )}
        </>
      )}

      {/* ── all of / any of ───────────────────────────────────────────── */}
      {combo && (
        <div className="space-y-2">
          <label className="block text-xs font-semibold text-slate-500">
            {form.shape === 'all_of' ? 'Pays when ALL of these are true' : 'Pays when enough of these are true'}
          </label>

          {form.conditions.map((c, i) => {
            const cm = metrics.find((m) => m.value === c.metric_key) || null;
            return (
              <div key={i} className="p-2 rounded-xl border border-slate-200 space-y-2">
                <div className="flex gap-2 items-start">
                  <div className="flex-1 min-w-0">
                    <FormSelect
                      value={c.metric_key}
                      onChange={(v) => setCondition(i, { metric_key: v || '', metric_filter: '' })}
                      options={metricOptions}
                      searchType="score_metric"
                      placeholder={`Condition ${i + 1}`}
                      clearable={false}
                    />
                  </div>
                  <button
                    type="button" onClick={() => dropCondition(i)}
                    disabled={form.conditions.length === 1}
                    aria-label={`Remove condition ${i + 1}`}
                    className="min-h-11 w-11 shrink-0 grid place-items-center rounded-xl
                               border border-slate-200 text-slate-400 disabled:opacity-40"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
                {c.metric_key && (
                  <div className="flex flex-col sm:flex-row gap-2">
                    {cm?.filter_values?.length > 0 && (
                      <div className="flex-1 min-w-0">
                        <FormSelect
                          value={c.metric_filter}
                          onChange={(v) => setCondition(i, { metric_filter: v || '' })}
                          options={[
                            { value: '', label: `Any ${(cm.filter_label || 'value').toLowerCase()}` },
                            ...cm.filter_values.map((v) => ({ value: v, label: v })),
                          ]}
                          clearable={false}
                        />
                      </div>
                    )}
                    <label className="flex items-center gap-2 shrink-0">
                      <span className="text-xs text-slate-500">at least</span>
                      <input
                        type="number" min="1" value={c.threshold}
                        onChange={(e) => setCondition(i, { threshold: e.target.value })}
                        aria-label={`How many for condition ${i + 1}`}
                        className={numField}
                      />
                    </label>
                  </div>
                )}
              </div>
            );
          })}

          <Button size="sm" variant="secondary" className="min-h-11" onClick={addCondition}>
            <Plus size={13} /> Add a condition
          </Button>

          {form.shape === 'any_of' && (
            <label className="flex items-center gap-2">
              <span className="text-sm text-slate-600">How many are enough?</span>
              <input
                type="number" min="1" max={filledConditions.length || 1}
                value={form.require_count}
                onChange={(e) => set({ require_count: e.target.value })}
                aria-label="How many conditions are enough"
                className={numField}
              />
              <span className="text-sm text-slate-400">of {filledConditions.length || '—'}</span>
            </label>
          )}

          <p className="text-xs text-slate-400">
            Partial pays nothing &mdash; the student sees how far along they are, and
            all the points land at once when they finish.
          </p>
        </div>
      )}

      {/* ── points, and a cap ─────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="flex-1 min-w-0">
          <label className="block text-xs font-semibold text-slate-500 mb-1">
            {form.rule_test === 'tiered' ? 'Points (set by the tiers above)' : 'Points'}
          </label>
          <div className="relative">
            <input
              type="number" min="0" max="100" step="0.01" value={form.points}
              onChange={(e) => set({ points: e.target.value })}
              disabled={form.rule_test === 'tiered'}
              aria-label="Points" className={`${field} pr-11 disabled:opacity-50`}
            />
            <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-slate-400">pts</span>
          </div>
        </div>
        {!combo && ['each', 'streak', 'tiered'].includes(form.rule_test) && (
          <div className="flex-1 min-w-0">
            <label className="block text-xs font-semibold text-slate-500 mb-1">Cap (optional)</label>
            <input
              type="number" min="1" value={form.cap_value}
              onChange={(e) => set({ cap_value: e.target.value })}
              placeholder="No limit" aria-label="Most times one student can be paid"
              className={field}
            />
          </div>
        )}
      </div>

      <div>
        <label className="block text-xs font-semibold text-slate-500 mb-1">
          Name shown to students {combo ? '' : '(optional)'}
        </label>
        <input
          value={form.label} onChange={(e) => set({ label: e.target.value })}
          placeholder={combo ? 'e.g. Getting started' : (meta ? `e.g. ${meta.label}` : 'Leave blank for a default')}
          aria-label="Rule name" className={field}
        />
      </div>

      {/* Off by default on purpose -- see the header note. */}
      <label className="flex items-start gap-2 cursor-pointer">
        <input
          type="checkbox" checked={form.backfill}
          onChange={(e) => set({ backfill: e.target.checked })}
          className="mt-0.5 w-4 h-4 shrink-0"
        />
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-slate-700">Apply to what students have already done</span>
          <span className="block text-xs text-slate-400">
            Off, this only counts activity from now on. On, it pays for past
            activity too &mdash; check the preview before you do.
          </span>
        </span>
      </label>

      {/* ── the settings most rules never need ────────────────────────── */}
      <button
        type="button" onClick={() => setMore((v) => !v)}
        className="min-h-11 text-sm font-semibold text-violet-600"
      >
        {more ? 'Fewer options' : 'More options'}
      </button>

      {more && (
        <div className="space-y-3 p-3 rounded-xl border border-slate-200">
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="flex-1 min-w-0">
              <label className="block text-xs font-semibold text-slate-500 mb-1">Stops on</label>
              <DatePicker
                value={form.until_at || ''}
                onChange={(iso) => set({ until_at: iso || '' })}
                min={new Date().toISOString().slice(0, 10)}
                id="rule-stops-on"
              />
              <p className="mt-1 text-xs text-slate-400">
                For a campaign. Points already given are kept.
              </p>
            </div>
            <div className="flex-1 min-w-0">
              <label className="block text-xs font-semibold text-slate-500 mb-1">Points lapse after</label>
              <input
                type="number" min="1" value={form.expires_days}
                onChange={(e) => set({ expires_days: e.target.value })}
                placeholder="Never" aria-label="Days before these points stop counting"
                className={field}
              />
              <p className="mt-1 text-xs text-slate-400">
                Days. Nothing is deleted &mdash; clear this and they come back.
              </p>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">
              Only these students (optional)
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <FormSelect
                value={form.segment_education || ''}
                onChange={(v) => set({ segment_education: v || '' })}
                options={segClassOptions}
                placeholder="Any class" aria-label="Only this education level"
              />
              <FormSelect
                value={form.segment_degree || ''}
                onChange={(v) => set({ segment_degree: v || '' })}
                options={segDegrees.map(d => ({ value: d, label: d }))}
                placeholder="Any degree" aria-label="Only this degree"
              />
              <FormSelect
                value={form.segment_state || ''}
                onChange={(v) => set({ segment_state: v || '' })}
                options={segStates.map(n => ({ value: n, label: n }))}
                placeholder="Any state" aria-label="Only this state"
              />
            </div>
            <p className="mt-1 text-xs text-slate-400">Leave blank for everyone.</p>
          </div>
        </div>
      )}

      {shownPreview && (
        <div className={`rounded-xl p-3 border ${
          shownPreview.students > 0 ? 'border-violet-200 bg-violet-50' : 'border-slate-200 bg-slate-50'}`}>
          {shownPreview.students > 0 ? (
            <p className="text-sm text-slate-700">
              Matches <strong>{shownPreview.students}</strong> student{shownPreview.students === 1 ? '' : 's'} right now
              {' '}&mdash; <strong>{shownPreview.awards}</strong> award{shownPreview.awards === 1 ? '' : 's'},
              {' '}<strong>{shownPreview.points}</strong> points.
            </p>
          ) : (
            <p className="text-sm text-slate-500">
              Nobody matches yet. The rule still arms for future activity.
            </p>
          )}
        </div>
      )}

      <div className="flex gap-2">
        <Button size="sm" className="min-h-11" onClick={save} disabled={!ready || saving}>
          <Save size={13} /> {saving ? 'Saving…' : 'Add rule'}
        </Button>
        <Button size="sm" variant="secondary" className="min-h-11" onClick={onCancel}>
          <X size={13} /> Cancel
        </Button>
      </div>
    </div>
  );
}
