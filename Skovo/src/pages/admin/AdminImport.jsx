import React, { useRef, useState } from 'react';
import { adminApi as api } from '../../services/api';
import { ConfirmModal } from '../../components/ui/TableComponents';
import {
  Upload, FileSpreadsheet, CheckCircle2, AlertTriangle, Loader2, Copy, Check, Eye,
} from 'lucide-react';

/**
 * Bulk CSV import for the catalogue — colleges, their courses, and cutoffs.
 *
 * These three tables are what decide whether SKOVO is a one-state product or a
 * national one, and nobody is typing 45,000 colleges into a form. The data
 * arrives as spreadsheets that get corrected and re-sent, so every import is an
 * idempotent upsert and a re-import updates rather than duplicates.
 *
 * Validate first is the default path: a dry run reports exactly what would
 * happen without writing a row.
 */

const ENTITIES = [
  {
    key: 'colleges',
    label: 'Colleges',
    blurb: 'The college list itself. Matched on name + city.',
    required: ['name', 'city'],
    optional: ['type', 'state', 'nirf_ranking', 'naac_grade', 'annual_fees_min',
               'annual_fees_max', 'website_url', 'about', 'established_year'],
    sample: 'IIT Madras,Chennai,Tamil Nadu,government,1,A++,200000,250000,,,1959',
  },
  {
    key: 'college_courses',
    label: 'College courses',
    blurb: 'What each college offers. The college must already exist.',
    required: ['college_name', 'course_name'],
    optional: ['city', 'branch_code', 'degree_type', 'duration_years', 'total_seats', 'annual_fee'],
    sample: 'IIT Madras,B.Tech Computer Science,Chennai,CSE,UG,4,120,200000',
  },
  {
    key: 'cutoffs',
    label: 'Cutoffs',
    blurb: 'Closing ranks by exam, year and category. Powers the College Predictor.',
    required: ['college_name', 'branch_name', 'exam_type', 'year', 'category', 'closing_rank'],
    optional: ['city', 'state', 'college_type', 'branch_code', 'gender',
               'opening_rank', 'total_seats', 'source'],
    sample: 'IIT Madras,Computer Science,JEE Advanced,2025,General,158,Chennai,Tamil Nadu,government,CSE,All,1,,JoSAA 2025 R6',
  },
];

function Pill({ children, tone = 'slate' }) {
  const tones = {
    slate:   'bg-slate-100 text-slate-600',
    emerald: 'bg-emerald-50 text-emerald-700',
    amber:   'bg-amber-50 text-amber-700',
    red:     'bg-red-50 text-red-700',
  };
  return <span className={`px-2 py-0.5 rounded-md text-xs font-bold ${tones[tone]}`}>{children}</span>;
}

export default function AdminImport() {
  const [entity, setEntity] = useState(ENTITIES[0]);
  const [csv, setCsv]       = useState('');
  const [busy, setBusy]     = useState(false);
  const [result, setResult] = useState(null);
  const [confirmDlg, setConfirmDlg] = useState(null);
  const [error, setError]   = useState('');
  const [copied, setCopied] = useState(false);
  const fileRef = useRef(null);

  const header = [...entity.required, ...entity.optional].join(',');

  const pickEntity = (e) => { setEntity(e); setResult(null); setError(''); };

  const readFile = (ev) => {
    const file = ev.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { setCsv(String(reader.result || '')); setResult(null); };
    reader.readAsText(file);
  };

  const copyHeader = () => {
    navigator.clipboard?.writeText(header);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  // send(true) is a dry run and changes nothing, so it stays one click. The
  // real import writes rows in bulk with no undo, which is exactly the action
  // worth a pause — and it names the row count so a wrong paste is visible.
  const confirmImport = () => {
    const rows = csv.trim().split(/\r?\n/).filter(Boolean).length - 1;
    setConfirmDlg({
      message: `Import ${rows > 0 ? rows : ''} ${entity.label || entity.key} row${rows === 1 ? '' : 's'}?`,
      detail: 'This writes to the database immediately and cannot be undone. Run the dry run first if you have not already.',
      confirmLabel: 'Import for real',
      danger: true,
      onConfirm: () => send(false),
    });
  };

  async function send(dryRun) {
    if (!csv.trim() || busy) return;
    setBusy(true); setError(''); setResult(null);
    try {
      const { data } = await api.post(`/skovo-platform-panel-admin/import/${entity.key}`,
                                      { csv, dry_run: dryRun });
      if (data.bool) setResult({ ...data.response, dry_run: dryRun });
      else setError(data.response?.message || 'Import failed.');
    } catch (e) {
      setError(e.message || 'Import failed.');
    } finally { setBusy(false); }
  }

  const rowCount = csv.trim() ? Math.max(0, csv.trim().split('\n').length - 1) : 0;

  return (
    <div className="p-4 sm:p-6 max-w-5xl">
      {confirmDlg && (
        <ConfirmModal
          message={confirmDlg.message} detail={confirmDlg.detail}
          confirmLabel={confirmDlg.confirmLabel} danger={confirmDlg.danger}
          onConfirm={() => { confirmDlg.onConfirm(); setConfirmDlg(null); }}
          onCancel={() => setConfirmDlg(null)}
        />
      )}
      <div className="mb-6">
        <h1 className="text-2xl font-black text-slate-900">Bulk Import</h1>
        <p className="text-sm text-slate-500 mt-1">
          Load colleges, courses and cutoffs from CSV. Re-importing a corrected file updates
          the existing rows — it never creates duplicates.
        </p>
      </div>

      {/* What am I importing */}
      <div className="grid sm:grid-cols-3 gap-3 mb-5">
        {ENTITIES.map(e => {
          const on = e.key === entity.key;
          return (
            <button key={e.key} onClick={() => pickEntity(e)}
              className={`text-left flex items-start gap-3 p-3 sm:p-4 rounded-2xl border-2 transition-all ${
                on ? 'chip-active' : 'border-slate-200 bg-white hover:border-slate-300'}`}>
              {/* Icon left keeps each choice to two lines on a phone. */}
              <span className={`shrink-0 w-8 h-8 rounded-lg flex items-center justify-center ${on ? 'bg-white/60' : 'bg-slate-100'}`}>
                <FileSpreadsheet size={16} className={on ? 'text-accent' : 'text-slate-400'} />
              </span>
              <span className="min-w-0">
                <span className={`block text-sm font-bold ${on ? 'text-accent' : 'text-slate-800'}`}>{e.label}</span>
                <span className="block text-[11px] text-slate-400 mt-0.5 leading-snug">{e.blurb}</span>
              </span>
            </button>
          );
        })}
      </div>

      {/* The expected shape */}
      <div className="bg-white border border-slate-200 rounded-2xl p-4 mb-4">
        <div className="flex items-center gap-2 mb-2">
          <p className="text-xs font-bold text-slate-700">Expected columns</p>
          <button onClick={copyHeader}
                  className="ml-auto py-3 text-xs font-semibold text-slate-500 hover:text-slate-800 flex items-center gap-1">
            {copied ? <><Check size={12} /> Copied</> : <><Copy size={12} /> Copy header row</>}
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5 mb-2">
          {entity.required.map(h => <Pill key={h} tone="emerald">{h} *</Pill>)}
          {entity.optional.map(h => <Pill key={h}>{h}</Pill>)}
        </div>
        <p className="text-[11px] text-slate-400">
          <b className="text-emerald-700">Green</b> columns are required — a row missing one is
          skipped and reported. Column order does not matter; blank cells stay empty rather
          than becoming zero.
        </p>
        <div className="mt-3 overflow-x-auto">
          <pre className="text-[11px] bg-slate-50 rounded-xl p-3 text-slate-600 whitespace-pre-wrap break-all sm:whitespace-pre sm:break-normal">
{header + '\n' + entity.sample}
          </pre>
        </div>
      </div>

      {/* Paste or upload */}
      <div className="bg-white border border-slate-200 rounded-2xl p-4 mb-4">
        <div className="flex items-center gap-2 mb-2">
          <p className="text-xs font-bold text-slate-700">CSV content</p>
          {rowCount > 0 && <Pill>{rowCount} data row{rowCount === 1 ? '' : 's'}</Pill>}
          <button onClick={() => fileRef.current?.click()}
                  className="ml-auto py-3 text-xs font-semibold text-slate-500 hover:text-slate-800 flex items-center gap-1">
            <Upload size={12} /> Choose a .csv file
          </button>
          <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={readFile} />
        </div>
        <textarea
          value={csv} onChange={e => { setCsv(e.target.value); setResult(null); }}
          rows={10} spellCheck={false}
          placeholder={`Paste CSV here, or choose a file…\n\n${header}`}
          className="w-full border border-slate-200 rounded-xl p-3 text-xs font-mono outline-none"
        />
        <div className="flex flex-wrap gap-2 mt-3">
          <button onClick={() => send(true)} disabled={busy || !csv.trim()}
                  className="px-4 py-2.5 rounded-xl text-sm font-bold border border-slate-200 text-slate-700 bg-white disabled:opacity-40 flex items-center gap-1.5">
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Eye size={14} />} Validate only
          </button>
          <button onClick={confirmImport} disabled={busy || !csv.trim()}
                  className="px-4 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-40 flex items-center gap-1.5"
                  style={{ backgroundColor: 'var(--accent)' }}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />} Import
          </button>
          <p className="text-[11px] text-slate-400 self-center">
            Validate runs every check and writes nothing.
          </p>
        </div>
        {error && (
          <p className="text-sm text-red-600 mt-3 flex items-start gap-1.5">
            <AlertTriangle size={14} className="shrink-0 mt-0.5" />{error}
          </p>
        )}
      </div>

      {/* What happened */}
      {result && (
        <div className="bg-white border border-slate-200 rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-3">
            {result.skipped > 0
              ? <AlertTriangle size={16} className="text-amber-500" />
              : <CheckCircle2 size={16} className="text-emerald-600" />}
            <p className="text-sm font-bold text-slate-900">
              {result.dry_run ? 'Validation result' : 'Import complete'}
            </p>
            {result.dry_run && <Pill tone="amber">nothing was written</Pill>}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
            {[
              ['Rows read', result.rows_read, 'slate'],
              [result.dry_run ? 'Would import' : 'Created', result.created, 'emerald'],
              ['Updated', result.updated, 'slate'],
              ['Skipped', result.skipped, result.skipped ? 'red' : 'slate'],
            ].map(([label, value, tone]) => (
              <div key={label} className="rounded-xl bg-slate-50 px-3 py-2.5">
                <p className="text-[11px] text-slate-400">{label}</p>
                <p className={`text-lg font-bold ${tone === 'emerald' ? 'text-emerald-600'
                  : tone === 'red' ? 'text-red-600' : 'text-slate-800'}`}>{value ?? 0}</p>
              </div>
            ))}
          </div>

          <p className="text-xs text-slate-500">{result.message}</p>

          {(result.errors || []).length > 0 && (
            <div className="mt-3">
              <p className="text-xs font-bold text-slate-700 mb-1.5">
                Rows that need attention ({result.errors.length})
              </p>
              <div className="max-h-56 overflow-y-auto border border-slate-100 rounded-xl">
                {result.errors.map((e, i) => (
                  <div key={i} className="flex gap-3 px-3 py-2 text-xs border-b border-slate-50 last:border-0">
                    <span className="font-mono text-slate-400 shrink-0">line {e.row}</span>
                    <span className="text-slate-600">{e.error}</span>
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-slate-400 mt-2">
                Fix these lines and import the file again — rows that already went in will be
                updated, not duplicated.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
