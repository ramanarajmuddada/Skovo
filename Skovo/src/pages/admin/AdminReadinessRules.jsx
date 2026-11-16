import React, { useEffect, useState } from 'react';
import { adminApi as api } from '../../services/api';
import { Settings, Save, CheckCircle, X } from 'lucide-react';
import { ConfirmModal } from '../../components/ui/TableComponents';

function Toast({ msg, ok }) {
  if (!msg) return null;
  return (
    <div className={`fixed bottom-6 right-6 z-100 px-5 py-3 rounded-xl text-sm font-semibold shadow-xl flex items-center gap-2 ${ok ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'}`}>
      {ok ? <CheckCircle size={16} /> : <X size={16} />} {msg}
    </div>
  );
}

function Field({ label, hint, name, value, min, max, onChange }) {
  // Label and hint tied to the box: tapping the label focuses it, and a screen
  // reader names it — every number here announced as just "spin button".
  const id = `rr-${name}`;
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-semibold text-slate-700">{label}</label>
      {hint && <p id={`${id}-hint`} className="text-xs text-slate-400">{hint}</p>}
      <input
        id={id}
        aria-describedby={hint ? `${id}-hint` : undefined}
        type="number"
        name={name}
        value={value}
        min={min}
        max={max}
        onChange={onChange}
        className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
      />
    </div>
  );
}

const DEFAULTS = {
  // 60, not 65. This fallback is what the form shows if the GET fails, and
  // saving from that state would have written 65 into the live config -- four
  // points above every screen that counts a student down to 60.
  opportunity_unlock_score: 60,
  decay_grace_days: 7,
  decay_per_day: 1,
  decay_interval_days: 1,
  decay_restore_percent: 50,
  pause_tokens_per_year: 2,
  pause_days: 21,
};

export default function AdminReadinessRules() {
  const [form,    setForm]    = useState(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving,  setSaving]  = useState(false);
  const [toast,   setToast]   = useState(null);
  const [confirmDlg, setConfirmDlg] = useState(null);
  const [levels, setLevels] = useState([]);
  const [savingLevels, setSavingLevels] = useState(false);

  const showToast = (msg, ok = true) => { setToast({ msg, ok }); setTimeout(() => setToast(null), 3000); };

  const load = () => {
    setLoading(true);
    api.get('/skovo-platform-panel-admin/readiness-rules')
      .then(({ data }) => {
        if (data.bool) setForm(data.response || DEFAULTS);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  const loadLevels = () => {
    api.get('/skovo-platform-panel-admin/readiness-levels')
      .then(({ data }) => { if (data.bool) setLevels(data.response.levels || []); })
      .catch(() => {});
  };

  useEffect(() => { load(); loadLevels(); }, []);

  // Saved as a set, not one at a time: the levels only make sense together, and
  // saving one row could leave two bands claiming the same score or a gap with
  // no level at all. The server re-labels every stored score afterwards, because
  // readiness_scores.level holds the word, so a rename would otherwise leave old
  // rows showing the old one.
  const saveLevels = async () => {
    setSavingLevels(true);
    try {
      const payload = levels.map((l) => ({ label: l.label, min_score: Number(l.min_score) }));
      const { data } = await api.put('/skovo-platform-panel-admin/readiness-levels', { levels: payload });
      if (data.bool) { showToast(data.response.message || 'Levels saved'); setLevels(data.response.levels || []); }
      else showToast(data.response?.message || 'Could not save levels', false);
    } catch {
      showToast('Network error. Try again.', false);
    } finally {
      setSavingLevels(false);
    }
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((f) => ({ ...f, [name]: Number(value) }));
  };

  // These weights decide every student's readiness score, so a save here is
  // retroactive across the whole platform rather than a change to one record.
  const confirmSave = (e) => {
    e.preventDefault();
    setConfirmDlg({
      message: 'Save readiness scoring rules?',
      detail: 'These weights apply to every student on the platform, including scores already shown to them.',
      confirmLabel: 'Save rules',
      onConfirm: () => handleSave(),
    });
  };

  const handleSave = async (e) => {
    // Optional chain, not e.preventDefault(). The form's submit goes through
    // confirmSave, which already prevented the default and then calls this as
    // handleSave() with NO event -- so `e` was undefined here and this threw
    // before the PUT was ever made. The dialog closed, nothing saved, and no
    // error was shown, so the screen looked like it had worked.
    e?.preventDefault?.();
    setSaving(true);
    try {
      const { data } = await api.put('/skovo-platform-panel-admin/readiness-rules', form);
      if (data.bool) showToast('Rules saved successfully');
      else showToast(data.response?.message || 'Failed to save', false);
    } catch {
      showToast('Network error. Try again.', false);
    } finally {
      setSaving(false);
    }
  };

  // Live preview of score breakdown

  return (
    <div className="p-4 sm:p-6">
      {confirmDlg && (
        <ConfirmModal
          message={confirmDlg.message} detail={confirmDlg.detail}
          confirmLabel={confirmDlg.confirmLabel} danger={confirmDlg.danger}
          onConfirm={() => { confirmDlg.onConfirm(); setConfirmDlg(null); }}
          onCancel={() => setConfirmDlg(null)}
        />
      )}
      <Toast msg={toast?.msg} ok={toast?.ok} />

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-black text-slate-900">Readiness Rules</h1>
          <p className="text-sm text-slate-500 mt-1">Decay, pauses, levels and the score that unlocks Opportunities</p>
        </div>
      </div>

      {loading ? (
        <div className="space-y-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-16 bg-slate-100 rounded-2xl animate-pulse" />
          ))}
        </div>
      ) : (
        <form onSubmit={confirmSave} className="space-y-6">
          {/* Cohort Scoring */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5">
            <h2 className="text-sm font-bold text-slate-800 mb-4 flex items-center gap-2">
              <span className="w-6 h-6 bg-amber-100 text-amber-600 rounded-lg flex items-center justify-center text-xs font-black">D</span>
              Score Decay
            </h2>
            {/* Replaces "Cohort Enrollment Scoring" and "Task Submission
                Scoring". Those wrote real columns that nothing reads when a
                score is calculated -- the score_events ledger does that, from
                Score Engine -- so they were two forms that saved and changed
                nothing. Decay and pause are the opposite: used by the nightly
                job, but no endpoint accepted them, so the only way to change
                how fast a score fell was to edit the row by hand. */}
            <p className="text-xs text-slate-400 -mt-2 mb-3">
              An idle score falls, so a number earned months ago does not stand forever.
            </p>
            <div className="grid sm:grid-cols-2 gap-4">
              <Field
                label="Idle grace period (days)"
                hint="Days of no activity before a score starts falling"
                name="decay_grace_days"
                value={form.decay_grace_days}
                min={0} max={365}
                onChange={handleChange}
              />
              <Field
                label="Points lost each time"
                hint="How much comes off on each cut"
                name="decay_per_day"
                value={form.decay_per_day}
                min={0} max={20}
                onChange={handleChange}
              />
              {/* Decay used to be fixed at once a day, so four weeks of silence
                  wiped a whole score and the only way to soften it was a
                  fractional rate. The gap between cuts is a policy, not a
                  constant: 1 is daily, 7 is weekly, 30 is monthly. */}
              <Field
                label="Cut every (days)"
                hint="1 = every day · 7 = once a week · 30 = once a month"
                name="decay_interval_days"
                value={form.decay_interval_days}
                min={1} max={365}
                onChange={handleChange}
              />
              {/* Decay only ever subtracted -- nothing gave points back, so a
                  student who missed a month had to earn all of it again just to
                  stand where they were. 0 keeps that; 100 wipes the slate on
                  return, which makes decay meaningless after one login. */}
              <Field
                label="Give back on return (%)"
                hint="Of the points lost to inactivity. 0 = nothing, 100 = all of it"
                name="decay_restore_percent"
                value={form.decay_restore_percent}
                min={0} max={100}
                onChange={handleChange}
              />
            </div>
          </div>

          {/* Pauses */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5">
            <h2 className="text-sm font-bold text-slate-800 mb-4 flex items-center gap-2">
              <span className="w-6 h-6 bg-violet-100 text-violet-600 rounded-lg flex items-center justify-center text-xs font-black">P</span>
              Pauses
            </h2>
            <p className="text-xs text-slate-400 -mt-2 mb-3">
              A student freezes their own score for exams or a break. Nothing is
              spent for them &mdash; it is their choice, and their allowance.
            </p>
            <div className="grid sm:grid-cols-2 gap-4">
              <Field
                label="Pauses per year"
                hint="How many times a student may freeze their score"
                name="pause_tokens_per_year"
                value={form.pause_tokens_per_year}
                min={0} max={12}
                onChange={handleChange}
              />
              <Field
                label="Pause length (days)"
                hint="How long one pause lasts"
                name="pause_days"
                value={form.pause_days}
                min={1} max={180}
                onChange={handleChange}
              />
            </div>
          </div>

          {/* Level Thresholds -- any number of them.
              These were two number fields for a fixed Explorer / Pioneer /
              Achiever, with the names hardcoded in sp_score_recalc and eight
              other files. "Achiever" is also the mentor role, so a student
              reaching the gate was given the same title as the people
              mentoring them. Rows in readiness_levels now: rename one, add one,
              remove one, and the next recalc uses it. */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5">
            <h2 className="text-sm font-bold text-slate-800 mb-1 flex items-center gap-2">
              <span className="w-6 h-6 bg-purple-100 text-purple-600 rounded-lg flex items-center justify-center text-xs font-black">L</span>
              Level Thresholds
            </h2>
            <p className="text-xs text-slate-400 mb-4">
              The name a student is given once they reach that score. The lowest must start at 0.
            </p>

            <div className="space-y-2">
              {levels.map((lv, i) => (
                <div key={i} className="flex gap-2 items-start">
                  <input
                    value={lv.label}
                    onChange={(e) => setLevels((ls) => ls.map((x, k) => k === i ? { ...x, label: e.target.value } : x))}
                    placeholder="Level name"
                    aria-label={`Level ${i + 1} name`}
                    className="min-w-0 flex-1 min-h-11 px-3 border border-slate-200 rounded-xl text-sm"
                  />
                  <input
                    type="number" min={0} max={100}
                    value={lv.min_score}
                    onChange={(e) => setLevels((ls) => ls.map((x, k) => k === i ? { ...x, min_score: Number(e.target.value) } : x))}
                    aria-label={`Level ${i + 1} from score`}
                    className="w-14 shrink-0 min-h-11 px-2 border border-slate-200 rounded-xl text-sm text-center tabular-nums"
                  />
                  <button
                    type="button"
                    onClick={() => setLevels((ls) => ls.filter((_, k) => k !== i))}
                    disabled={levels.length <= 1}
                    aria-label={`Remove ${lv.label || 'level'}`}
                    className="shrink-0 min-h-11 w-11 rounded-xl border border-slate-200 text-slate-400 hover:text-red-600 disabled:opacity-30 flex items-center justify-center"
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>

            <button
              type="button"
              onClick={() => setLevels((ls) => [...ls, { label: '', min_score: '' }])}
              disabled={levels.length >= 10}
              className="mt-3 min-h-11 px-4 rounded-xl border border-slate-200 text-sm font-semibold text-slate-600 disabled:opacity-40"
            >
              Add a level
            </button>
            <button
              type="button"
              onClick={saveLevels}
              disabled={savingLevels}
              className="mt-3 ml-2 min-h-11 px-4 rounded-xl text-sm font-bold text-white disabled:opacity-50"
              style={{ backgroundColor: 'var(--accent)' }}
            >
              {savingLevels ? 'Saving…' : 'Save levels'}
            </button>
          </div>

          {/* Opportunity Unlock */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5">
            <h2 className="text-sm font-bold text-slate-800 mb-4 flex items-center gap-2">
              <span className="w-6 h-6 bg-amber-100 text-amber-600 rounded-lg flex items-center justify-center text-xs font-black">O</span>
              Opportunity Access
            </h2>
            <Field
              label="Opportunity unlock score"
              hint="Students with readiness score ≥ this value can view and apply for opportunities"
              name="opportunity_unlock_score"
              value={form.opportunity_unlock_score}
              min={0} max={100}
              onChange={handleChange}
            />
          </div>

          {/* Preview */}
          <div className="bg-slate-50 rounded-2xl border border-slate-200 p-5">
            <p className="text-xs font-bold text-slate-600 uppercase tracking-wider mb-3">Score Preview</p>
            {/* Built from the levels above, not from three fixed rows.
                It used to hardcode Explorer / Pioneer / Achiever off
                pioneer_min and achiever_min, so after the levels became
                editable this panel still showed the old three and the old
                bands -- the screen disagreed with itself. */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-center">
              {[...levels]
                .sort((a, b) => Number(a.min_score) - Number(b.min_score))
                .map((lv, i, all) => {
                  const next = all[i + 1];
                  // The top band has no upper bound; the others stop one short
                  // of where the next one starts.
                  const range = next
                    ? `${lv.min_score} - ${Number(next.min_score) - 1}`
                    : `${lv.min_score}+`;
                  const tone = i === all.length - 1
                    ? 'text-emerald-700 bg-emerald-50'
                    : i === 0 ? 'text-slate-600 bg-slate-100' : 'text-blue-700 bg-blue-50';
                  return (
                    <div key={lv.id || i} className={`rounded-xl px-3 py-3 ${tone}`}>
                      <p className="font-bold text-sm break-words">{lv.label || '—'}</p>
                      <p className="text-xs opacity-70 mt-0.5">{range} pts</p>
                    </div>
                  );
                })}
            </div>
            {/* Was "Assessment 75 + Cohorts + Tasks = 125 pts". sp_score_recalc
                does clamp(0, 100, ...), so 125 was never reachable. */}
            <p className="text-xs text-slate-400 mt-3 text-center">
              Maximum score: <strong>100</strong>
            </p>
          </div>

          {/* Save */}
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={saving}
              className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-700 disabled:opacity-50 transition-all"
            >
              <Save size={15} />
              {saving ? 'Saving...' : 'Save Rules'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}


