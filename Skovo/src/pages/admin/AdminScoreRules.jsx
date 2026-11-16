import React, { useEffect, useState } from 'react';
import { Tabs } from '../../components/admin/v1/AdminV1Kit';
import { useMasters } from '../../hooks/useMasters';
import { adminApi as api } from '../../services/api';
import BatchPanel from '../../components/admin/BatchPanel';
import StudentAdjustPanel from '../../components/admin/StudentAdjustPanel';
import MetricRuleForm from '../../components/admin/MetricRuleForm';
import { Card, PageHeader, Badge, Toast, Button, SectionTitle } from '../../components/ui/index.jsx';
import { Sliders, Save, TrendingDown, PauseCircle, PlayCircle, Check, Pencil, Users, Trash2, Plus, ListChecks, ClipboardList, SlidersHorizontal, Search, Zap, Trophy, Lock } from 'lucide-react';
import StatTile from '../../components/admin/StatTile';
import { FormSelect } from '../../components/ui/index.jsx';
import ToggleSwitch from '../../components/ui/ToggleSwitch';
import { Pagination, ConfirmModal } from '../../components/ui/TableComponents';
import { usePagedRows } from '../../hooks/usePagedRows';

// One task can add this much at most (MAX_TASK_POINTS in admin_score_rules.py).
// The Readiness score tops out at 100, so one task should not be able to max it.
const MAX_TASK_POINTS = 20;
const POINTS_MSG = `Points must be from 1 to ${MAX_TASK_POINTS}.`;

// The whole row, so an edit or an expiry never blanks a field it did not mean to.
/* What the rule actually says, in words. A row that only shows a name and a
   number does not tell you what triggers it, and the trigger is the half an
   admin most often wants to check. */
function ruleSentence(rule, metrics, testLabels = {}) {
  if (!rule.metric_key) return null;
  const m = (metrics || []).find((x) => x.value === rule.metric_key);
  const bits = [m?.label || rule.metric_key];
  if (rule.metric_filter) bits.push(rule.metric_filter);
  // Label from master_score_rule_test, lower-cased to sit mid-sentence.
  const label = testLabels[rule.rule_test];
  const phrase = label ? label.charAt(0).toLowerCase() + label.slice(1) : (rule.rule_test || '');
  bits.push(rule.threshold ? `${phrase} ${rule.threshold}` : phrase);
  return bits.filter(Boolean).join(' \u00b7 ');
}

function capSentence(rule) {
  const type = (rule.cap_type || 'none').toLowerCase();
  // Tiered rules pay a different amount per item — say so, or "+5 pts" reads
  // as five for every cohort.
  if (rule.shape === 'tiered' && rule.tier_points) {
    const tiers = String(rule.tier_points).split(',').map(s => s.trim()).filter(Boolean).join(' / ');
    return rule.cap_value ? `${tiers} pts · first ${rule.cap_value}` : `${tiers} pts`;
  }
  // "When it starts" and "reaches N" can only fire once per student (the
  // score_events unique key), so "No limit" was untrue for them.
  if (['becomes_active', 'reaches'].includes(rule.rule_test) && (type === 'none' || type === 'once' || !rule.cap_value)) return 'Once';
  if (type === 'once' && (!rule.cap_value || Number(rule.cap_value) === 1)) return 'Once';
  if (type === 'none' || !rule.cap_value) return 'No limit';
  if (type === 'lifetime') return `Max ${rule.cap_value} per student`;
  if (type === 'once') return `Once, up to ${rule.cap_value}`;
  // Plain words, not the stored enum — "Max 1 per_item" read as a bug.
  if (type === 'per_item') return Number(rule.cap_value) === 1 ? 'Once per item' : `Max ${rule.cap_value} per item`;
  const per = { daily: 'a day', weekly: 'a week', monthly: 'a month', yearly: 'a year', per_stage: 'per stage' }[type];
  return per ? `Max ${rule.cap_value} ${per}` : `Max ${rule.cap_value} ${type.replace(/_/g, ' ')}`;
}

function RuleRow({ rule, onSave, saving, onDelete, metrics }) {
  const { lists } = useMasters(['score_cap_type', 'score_rule_test']);
  const testLabels = Object.fromEntries((lists.score_rule_test || []).map((t) => [t.value, t.label]));
  // Keep the master's labels. Mapping to bare values made the closed
  // select read "none" while the open list said "No cap" -- the same
  // option named two different things in the same control.
  const CAP_OPTIONS = (lists.score_cap_type || []).map(
    o => ({ value: o.value, label: o.label || o.value }));

  // Read-only until you ask to change it.
  //
  // Every field used to be a live input, so the list was a wall of boxes: at
  // 320px the rule name collapsed against Points, Cap window and Times, and
  // there was no way to read a rule without also being able to mistype it.
  // The row now states what the rule does; the pencil opens the fields.
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(rule);

  useEffect(() => { setForm(rule); }, [rule]);

  const dirty = Number(form.points) !== Number(rule.points)
    || form.cap_type !== rule.cap_type
    || String(form.cap_value ?? '') !== String(rule.cap_value ?? '')
    || form.is_active !== rule.is_active;

  const sentence = ruleSentence(rule, metrics, testLabels);

  const cancel = () => { setForm(rule); setEditing(false); };
  const save = async () => { await onSave(form); setEditing(false); };

  return (
    <div className={`py-3 border-b border-slate-100 last:border-0 ${rule.is_active ? '' : 'opacity-60'}`}>

      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-900 break-words">{rule.label}</p>
          {sentence && (
            <p className="mt-0.5 text-xs text-slate-400 break-words">{sentence}</p>
          )}
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <span className="font-bold" style={{ color: 'var(--accent)' }}>+{Number(rule.points)} {Number(rule.points) === 1 ? 'pt' : 'pts'}</span>
            <span className="text-slate-400">{capSentence(rule)}</span>
            {!rule.is_active && <span className="font-semibold text-slate-400">Off</span>}
          </div>
        </div>

        <div className="flex gap-1 shrink-0">
          <button
            type="button" onClick={() => setEditing((v) => !v)}
            aria-label={`Edit ${rule.label}`} aria-expanded={editing}
            className={`min-h-10 w-10 rounded-lg border flex items-center justify-center ${
              editing ? 'border-slate-300 text-slate-700 bg-slate-100'
                      : 'border-slate-200 text-slate-400 hover:text-slate-700'}`}>
            <Pencil size={14} />
          </button>
          {onDelete && (
            <button
              type="button" onClick={() => onDelete(rule)}
              aria-label={`Remove ${rule.label}`}
              className="min-h-10 w-10 rounded-lg border border-slate-200 text-slate-400 hover:text-red-600 flex items-center justify-center">
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </div>

      {editing && (
        <div className="mt-3 pt-3 border-t border-slate-100 space-y-3">

          {/* Cap window gets its own row.
              Beside Points and Times it had about 50px left at 320px, which
              collapsed the select AND its dropdown panel to one letter per
              line -- "No cap" rendered as a vertical N-o-c-a-p. */}
          <label className="block text-xs text-slate-400">
            Cap window
            <FormSelect searchType="score_cap_type"
              value={form.cap_type || 'none'}
              onChange={v => setForm((f) => ({
                ...f, cap_type: v, cap_value: v === 'none' ? null : f.cap_value,
              }))}
              options={CAP_OPTIONS}
              clearable={false} />
          </label>

          <div className="flex gap-2">
            <label className="text-xs text-slate-400 flex-1 min-w-0">
              Points
              <div className="relative">
                <input
                  type="number" min="0" step="0.01" value={form.points ?? ''}
                  onChange={(e) => setForm((f) => ({ ...f, points: Number(e.target.value) }))}
                  className="block w-full mt-0.5 pl-2.5 pr-9 min-h-11 border border-slate-200 rounded-lg text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <span className="pointer-events-none absolute right-2.5 bottom-3 text-xs text-slate-400">pts</span>
              </div>
            </label>

            <label className="text-xs text-slate-400 flex-1 min-w-0">
              Times
              <input
                type="number" min="1" value={form.cap_value ?? ''}
                placeholder={form.cap_type === 'none' ? 'No limit' : 'e.g. 10'}
                disabled={form.cap_type === 'none'}
                onChange={(e) => setForm((f) => ({ ...f, cap_value: e.target.value === '' ? null : Number(e.target.value) }))}
                className="block w-full mt-0.5 px-2.5 min-h-11 border border-slate-200 rounded-lg text-sm text-slate-900 disabled:bg-slate-50 disabled:text-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </label>
          </div>

          <ToggleSwitch checked={!!form.is_active}
                        onChange={(v) => setForm((f) => ({ ...f, is_active: v }))} />

          {rule.metric_key && (
            <p className="text-xs text-slate-400">
              What triggers this rule is fixed. To change it, remove this one and add it again.
            </p>
          )}

          {/* Phones: two equal halves, Save on the thumb side. Wider: compact, right-aligned. */}
          <div className="grid grid-cols-2 gap-2 sm:flex sm:justify-end">
            <Button size="sm" variant="secondary" className="min-h-11 w-full sm:w-auto sm:px-5 justify-center" onClick={cancel}>
              Cancel
            </Button>
            <Button size="sm" className="min-h-11 w-full sm:w-auto sm:px-5 justify-center disabled:opacity-40 disabled:cursor-not-allowed"
                    onClick={save} disabled={!dirty || saving}>
              <Save size={14} /> {saving ? 'Saving…' : 'Save'}
            </Button>
          </div>
          {!dirty && <p className="text-[11px] text-slate-400 text-right -mt-1">No changes yet</p>}
        </div>
      )}
    </div>
  );
}

/* ── Manual score adjustment (§5.7 — always audited) ─────────────────────── */
export default function AdminScoreRules() {
  const [tab, setTab] = useState('actions');
  const [adding, setAdding] = useState(false);
  const [rules, setRules] = useState([]);
  const [metrics, setMetrics] = useState([]);
  const [config, setConfig] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');
  const [toastType, setToastType] = useState('success');

  const flash = (msg, type = 'success') => {
    setToast(msg); setToastType(type);
    setTimeout(() => setToast(''), 4000);
  };

  const load = () =>
    api.get('/skovo-platform-panel-admin/score-rules')
      .then(({ data }) => {
        if (data.bool) {
          setRules(data.response.rules || []);
          setMetrics(data.response.metrics || []);
          setConfig(data.response.config || {});
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));

  useEffect(() => { load(); }, []);

  const handleSave = async (form) => {
    setSaving(true);
    try {
      const { data } = await api.put('/skovo-platform-panel-admin/score-rules', form);
      if (data.bool) { flash('Rule updated — it applies to every score from now on.'); load(); }
      else flash(data.response?.message || 'Could not save.', 'error');
    } catch { flash('Could not save the rule.', 'error'); } finally { setSaving(false); }
  };

  const runDecay = async () => {
    if (!window.confirm('Run the inactivity decay sweep now? It also runs nightly on its own.')) return;
    try {
      const { data } = await api.post('/skovo-platform-panel-admin/score-rules/run-decay', {});
      if (data.bool) flash(`Decay sweep complete — ${data.response.decayed} student(s) affected.`);
      else flash(data.response?.message || 'Sweep failed.', 'error');
    } catch { flash('Sweep failed.', 'error'); }
  };

  const [ruleQ, setRuleQ] = useState('');
  const matchQ = (r) => !ruleQ.trim() || (r.label || r.event_type || '').toLowerCase().includes(ruleQ.trim().toLowerCase());
  const active = rules.filter((r) => r.is_active && matchQ(r));
  const inactive = rules.filter((r) => !r.is_active && matchQ(r));
  const liveCount = rules.filter((r) => r.is_active).length;
  const topPts = Math.max(0, ...rules.filter((r) => r.is_active).map((r) => Number(r.points) || 0));
  // 60-odd switched-off actions — one page at a time, like every other list.
  // Above the loading return: a hook must run on every render, in order.
  const inactivePaged = usePagedRows(inactive);

  // Above the loading return — hooks run on every render, in order.
  const [pendingDelete, setPendingDelete] = useState(null);

  if (loading) {
    return <div className="p-4 sm:p-6"><div className="h-96 bg-white rounded-2xl border border-slate-200 animate-pulse" /></div>;
  }

  // Delete is a hard DELETE, so it asks first. Off actions can be deleted too
  // — that is where unwanted ones sit — and the server still refuses any action
  // that has already paid points (it would lower those students' scores).
  const askDelete = (rule) => setPendingDelete(rule);
  const deleteRule = async (rule) => {
    setPendingDelete(null);
    try {
      const { data } = await api.delete(`/skovo-platform-panel-admin/score-rules/rule/${rule.event_type}`);
      if (data.bool) { flash(data.response.message); load(); }
      else flash(data.response?.message || 'Could not remove.', 'error');
    } catch { flash('Could not remove.', 'error'); }
  };

  return (
    <div className="p-4 sm:p-6">
      <Toast message={toast} type={toastType} />
      {pendingDelete && (
        <ConfirmModal
          danger
          message={`Delete "${pendingDelete.label}" permanently?`}
          detail="It is removed from the database and cannot be undone. To stop it paying for now, switch it off instead."
          confirmLabel="Delete"
          onConfirm={() => deleteRule(pendingDelete)}
          onCancel={() => setPendingDelete(null)}
        />
      )}
      <PageHeader
        title="Score Engine"
        subtitle="What each action is worth, the tasks you hand out, and one-off adjustments."
      />

      {/* Three jobs, three tabs.
          This was one column: fourteen rule rows, then the task forms, then
          adjustments. On a phone that meant scrolling past every rule to reach
          the work you actually do daily. They are also different kinds of
          thing -- rules are set once and rarely touched, tasks are routine,
          adjustments are case-by-case.

          The four read-only cards that sat above (idle grace, decay rate,
          pause tokens, pause length) are gone: the same four values are
          editable on Readiness Rules, and showing them here as well meant two
          screens carrying the same numbers with only one able to change them. */}
      <Tabs className="mb-4" active={tab} onChange={setTab} tabs={[
        { key: 'actions', label: 'Actions', icon: ListChecks },
        { key: 'tasks',   label: 'Tasks', icon: ClipboardList },
        { key: 'adjust',  label: 'Adjust', icon: SlidersHorizontal },
      ]} />

      {tab === 'actions' && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <StatTile label="Live actions" value={liveCount} icon={Zap} tone="emerald" sub="students earn from these" />
            <StatTile label="Off" value={rules.length - liveCount} icon={PauseCircle} tone="amber" sub="give nothing now" />
            <StatTile label="Top reward" value={`+${topPts}`} icon={Trophy} tone="violet" sub="points, one action" />
            <StatTile label="Hub unlocks" value={config.opportunity_unlock_score ?? '—'} icon={Lock} tone="blue" sub="readiness score" />
          </div>
          <div className="relative mb-4">
            <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={ruleQ} onChange={(e) => setRuleQ(e.target.value)} type="search" aria-label="Search scoring actions"
                   placeholder="Search actions…"
                   className="w-full min-h-11 pl-10 pr-4 border border-slate-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <Card className="p-4 sm:p-5">
            <SectionTitle>Scoring actions</SectionTitle>
            <p className="text-xs text-slate-400 -mt-2 mb-3">
              Opportunity Hub unlocks at {config.opportunity_unlock_score}
            </p>
            {active.length === 0 ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                <p className="text-sm font-semibold text-amber-900">Nothing scores right now.</p>
                <p className="mt-1 text-xs text-amber-800 leading-relaxed">
                  With no active actions, nothing a student does adds points, so every
                  readiness score is frozen where it stands and decay is the only thing
                  still moving it. Past events are kept &mdash; add an action back and
                  its history counts again.
                </p>
              </div>
            ) : (
              /* Two columns from lg: 60+ rules as one column was a very long scroll. */
              <div className="grid lg:grid-cols-2 lg:gap-x-8">
                {active.map((r) => (
                  <RuleRow key={r.event_type} rule={r} onSave={handleSave} saving={saving} onDelete={askDelete} metrics={metrics} />
                ))}
              </div>
            )}

            {/* The event-key text box that used to live here is gone. A key
                had to match an award() call, so a typo produced a row that
                listed and never paid; the builder derives the key from the
                rule instead, and the metric list covers the product rather
                than fifteen hardcoded strings. */}
            {adding ? (
              <MetricRuleForm
                metrics={metrics}
                flash={flash}
                onCancel={() => setAdding(false)}
                onSaved={() => { setAdding(false); load(); }}
              />
            ) : (
              <Button size="sm" variant="secondary" className="mt-4 min-h-11" onClick={() => setAdding(true)}>
                <Plus size={13} /> Add a scoring action
              </Button>
            )}
          </Card>

          {inactive.length > 0 && (
            <Card className="p-4 sm:p-5 mt-4">
              <SectionTitle>Inactive</SectionTitle>
              <p className="text-xs text-slate-400 -mt-2 mb-3">
                Switched off, or still at 0 points — they give nothing until you set points and turn them on. Points already earned from them are kept.
              </p>
              <div className="grid lg:grid-cols-2 lg:gap-x-8">
                {inactivePaged.rows.map((r) => <RuleRow key={r.event_type} rule={r} onSave={handleSave} saving={saving} onDelete={askDelete} metrics={metrics} />)}
              </div>
              <div className="-mx-5 -mb-5 mt-3 rounded-b-2xl overflow-hidden">
                <Pagination {...inactivePaged.bind} />
              </div>
            </Card>
          )}

          {/* Decay runs nightly at 03:00. This fires the same sweep now, which
              docks points from every idle student immediately -- so it sits at
              the bottom of the rules tab rather than in the header, where it
              was one tap away from a platform-wide score drop. */}
          <Card className="p-5 mt-4">
            <SectionTitle>Decay sweep</SectionTitle>
            <p className="text-xs text-slate-400 -mt-2 mb-3">
              Runs by itself every night. Use this only to apply a change today, or to catch up
              after downtime — it lowers every idle student&rsquo;s score straight away.
            </p>
            <Button variant="secondary" onClick={runDecay}>
              <PlayCircle size={15} /> Run decay now
            </Button>
          </Card>
        </>
      )}

      {tab === 'tasks'  && <BatchPanel flash={flash} />}
      {tab === 'adjust' && <StudentAdjustPanel flash={flash} onDone={load} />}
    </div>
  );
}
