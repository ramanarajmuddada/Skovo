import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  LifeBuoy, Mail, Phone, Send, Clock, ChevronDown, Link2,
  CircleDot, Loader2, CheckCircle2, Inbox, Clock3,
} from 'lucide-react';
import { Tabs } from '../admin/v1/AdminV1Kit';
import {
  StudentPage, PageHeader, Card, Button, Input, Textarea,
  EmptyState, Toast, Badge, FormSelect,
} from '../ui/index.jsx';
import { LoadError } from '../ui/TableComponents';
import { fieldErrors, supportIssue } from '../../schemas/student';
import { useMasters } from '../../hooks/useMasters';
import FilePicker from '../ui/FilePicker';
import SupportChatPanel from './IssueChat';
import { MessageCircle } from 'lucide-react';

// Fallback only -- the live list is the `support_category` master, read via
// useMasters inside the component. Still exported because categoryLabel() needs
// a synchronous answer when rendering a stored issue whose category may have
// been retired from the master since.
export const CATEGORIES = [
  { value: 'payments', label: 'Payments' },
  { value: 'account', label: 'Account' },
  { value: 'documents', label: 'Documents' },
  { value: 'payouts', label: 'Payouts' },
  { value: 'other', label: 'Other' },
];

// Payments and Payouts need proof and the exact item, picked from a list.
const PROOF_REQUIRED = ['payments', 'payouts', 'refund', 'wallet'];
const MAX_PROOF = 3;
const PICK_LABEL = { payments: 'Which payment?', payouts: 'Which payout?', refund: 'Which payment?' };

const STATUS = {
  open: { label: 'Open', color: 'amber' },
  in_progress: { label: 'In progress', color: 'blue' },
  solved: { label: 'Solved', color: 'emerald' },
  closed: { label: 'Closed', color: 'slate' },
};

function mailtoHref(address, email) {
  const params = new URLSearchParams();
  params.set('subject', 'SKOVO support');
  if (email) params.set('body', `From: ${email}\n\n`);
  return `mailto:${address}?${params.toString()}`;
}

function telHref(num) {
  return `tel:${String(num || '').replace(/[^\d+]/g, '')}`;
}

function fmt(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-IN', { dateStyle: 'medium' });
}

function categoryLabel(v) {
  return CATEGORIES.find((c) => c.value === v)?.label || v || 'Other';
}

// One row per channel: icon, what and where, and the action beside it. As a
// stacked card with a full-width button it was ~150px tall and broke the email
// address mid-word on a phone.
function ContactCard({ c, email }) {
  const isEmail = c.channel === 'email';
  const href = isEmail ? mailtoHref(c.value, email) : telHref(c.value);
  return (
    <Card className="p-3.5 sm:p-4 flex items-center gap-3" hover animate>
      <div
        className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
        style={{ backgroundColor: 'color-mix(in srgb, var(--accent) 14%, transparent)', color: 'var(--accent)' }}
      >
        {isEmail ? <Mail size={17} /> : <Phone size={17} />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold text-slate-500">{c.label}</p>
        {/* Wraps rather than truncates: the address is the information. */}
        {/* An email may wrap after the "@", never mid-word ("skovoai.c / om"). */}
        <p className="text-sm font-semibold text-slate-900 break-words">
          {String(c.value || '').includes('@')
            ? <>{String(c.value).split('@')[0]}@<wbr />{String(c.value).split('@').slice(1).join('@')}</>
            : c.value}
        </p>
        {c.hours ? (
          <p className="text-[11px] text-slate-400 mt-0.5 flex items-center gap-1">
            <Clock size={10} /> {c.hours}
          </p>
        ) : null}
      </div>
      <a href={href} className="shrink-0">
        <Button type="button" className="min-h-10 px-4">
          {isEmail ? <Mail size={15} /> : <Phone size={15} />}
          <span className="hidden sm:inline">{isEmail ? 'Email' : 'Call'}</span>
        </Button>
      </a>
    </Card>
  );
}

function SolvedBox({ issue, api, onChanged }) {
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const act = async (path, body) => {
    setBusy(true); setErr('');
    try {
      const { data } = await api.post(`/support/issues/${issue.id}/${path}`, body || {});
      if (data.bool) { setAsking(false); setReason(''); onChanged?.(); }
      else setErr(data.response?.message || 'Could not save.');
    } catch { setErr('Could not save. Try again.'); } finally { setBusy(false); }
  };
  if (issue.closed) {
    return <p className="mt-3 text-xs text-slate-500 rounded-lg bg-slate-50 border border-slate-200 px-3 py-2">Closed. Raise a new issue if you need help.</p>;
  }
  return (
    <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 whitespace-normal">
      <p className="text-sm font-semibold text-emerald-800">
        {issue.confirmed ? '✅ You confirmed this is solved.' : '✅ Solved. Was this solved?'}
      </p>
      <p className="text-xs text-emerald-700 mt-0.5">You can still chat for 7 days. If it is not fixed, reopen it.</p>
      {!asking ? (
        <div className="flex flex-wrap gap-2 mt-2">
          {!issue.confirmed && (
            <button type="button" disabled={busy} onClick={() => act('confirm')}
                    className="min-h-10 px-4 rounded-xl text-sm font-semibold bg-white border border-emerald-300 text-emerald-700">👍 Yes, solved</button>
          )}
          {issue.can_reopen && (
            <button type="button" disabled={busy} onClick={() => setAsking(true)}
                    className="min-h-10 px-4 rounded-xl text-sm font-semibold bg-white border border-amber-300 text-amber-700">Reopen issue</button>
          )}
        </div>
      ) : (
        <div className="mt-2 space-y-2">
          <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000}
                    placeholder="What is still wrong?"
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm bg-white resize-none" />
          <div className="flex gap-2">
            <button type="button" disabled={busy || reason.trim().length < 5} onClick={() => act('reopen', { reason })}
                    className="min-h-10 px-4 rounded-xl text-sm font-semibold text-white disabled:opacity-50" style={{ backgroundColor: 'var(--accent)' }}>
              {busy ? 'Reopening…' : 'Reopen'}
            </button>
            <button type="button" onClick={() => setAsking(false)} className="min-h-10 px-3 text-sm text-slate-500">Cancel</button>
          </div>
        </div>
      )}
      {issue.reopen_count > 0 && <p className="text-[11px] text-emerald-700 mt-2">Reopened {issue.reopen_count} of 3 times.</p>}
      {err && <p className="text-xs text-red-500 mt-1">{err}</p>}
    </div>
  );
}

function IssueRow({ issue, onOpenChat, api, onChanged }) {
  const [open, setOpen] = useState(false);
  const st = STATUS[issue.closed ? 'closed' : issue.status] || STATUS.open;
  return (
    <Card className="overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full text-left p-4 sm:p-5 flex items-start gap-3 min-h-11"
        aria-expanded={open}
      >
        <CircleDot size={16} className="mt-0.5 shrink-0" style={{ color: 'var(--accent)' }} />
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-slate-900 break-words">{issue.subject}</p>
            <Badge color={st.color} size="xs">{st.label}</Badge>
            {issue.last_from === 'admin' && !issue.closed && (
              <span className="text-[11px] font-bold text-emerald-600">New reply</span>
            )}
            {issue.reopened && <span className="text-[11px] font-bold text-amber-600">Reopened</span>}
          </div>
          <p className="text-xs text-slate-400 mt-1">
            {categoryLabel(issue.category)} · {fmt(issue.created_at)}
          </p>
        </div>
        <ChevronDown
          size={16}
          className={`text-slate-400 shrink-0 mt-1 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && (
        <div className="px-4 sm:px-5 pb-4 sm:pb-5 pt-0 text-sm text-slate-600 whitespace-pre-wrap border-t border-slate-100">
          <p className="pt-3 leading-relaxed">{issue.body}</p>
          {(issue.reference_label || issue.reference_type) && (
            <p className="text-xs text-slate-400 mt-3 flex items-center gap-1">
              <Link2 size={11} /> {issue.reference_label || `${issue.reference_type} ${issue.reference_id || ''}`}
            </p>
          )}
          {issue.txn_ref && <p className="text-xs text-slate-400 mt-1">UTR / transaction ID: {issue.txn_ref}</p>}
          {issue.attachments?.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-2">
              {issue.attachments.map((f, k) => (
                <a key={k} href={f.url} target="_blank" rel="noopener noreferrer"
                   className="text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white"
                   style={{ color: 'var(--accent)' }}>📎 {f.name || `Proof ${k + 1}`}</a>
              ))}
            </div>
          )}

          {issue.status === 'solved' && <SolvedBox issue={issue} api={api} onChanged={onChanged} />}
          <button type="button" onClick={() => onOpenChat(issue)}
                  className="mt-3 inline-flex items-center gap-2 min-h-11 px-4 rounded-xl text-sm font-semibold text-white whitespace-normal"
                  style={{ backgroundColor: 'var(--accent)' }}>
            <MessageCircle size={15} /> {issue.messages ? `Open chat (${issue.messages})` : 'Chat with support'}
            {issue.last_from === 'admin' && issue.status !== 'solved' && (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-white/25">New reply</span>
            )}
          </button>
        </div>
      )}
    </Card>
  );
}

// One master serves both portals, and it has no audience column yet, so the
// topics that only make sense on the other side are hidden here: an achiever has
// no wallet, points or streak; a student has no payouts or verification documents.
const HIDDEN_FOR = {
  achiever: ['wallet', 'points_dispute', 'streak_restore', 'refund'],
  student: ['payouts', 'documents'],
};

export default function HelpSupportPage({ api, userEmail, source = 'web', audience = 'student' }) {
  // Categories come from the `support_category` master so an admin can add one
  // without a deploy. CATEGORIES above is the fallback if the call fails.
  const { lists } = useMasters(['support_category'], { support_category: CATEGORIES });
  const hidden = HIDDEN_FOR[audience] || [];
  // "Other" always last, whatever its sort order in the master.
  const categories = (lists.support_category?.length ? lists.support_category : CATEGORIES)
    .filter((c) => !hidden.includes(c.value))
    .sort((a, b) => (a.value === 'other') - (b.value === 'other'));
  // The achiever layout already pads <main>; StudentPage's own padding inset
  // this screen from every other achiever screen.
  const Wrap = audience === 'achiever' ? 'div' : StudentPage;
  const [contacts, setContacts] = useState([]);
  const [issues, setIssues] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [filter, setFilter] = useState('all');
  const [toast, setToast] = useState('');
  const [toastType, setToastType] = useState('success');
  const [sending, setSending] = useState(false);
  const [form, setForm] = useState({
    category: '',
    subject: '',
    body: '',
    reference_type: '',
    reference_id: '',
    txn_ref: '',
  });
  const [proof, setProof] = useState([]);        // [{url, name}]
  const [chatIssue, setChatIssue] = useState(null);
  // A sent message updates that one issue in place; the page never reloads.
  const afterSend = (resp) => {
    const id = chatIssue?.id;
    const patch = (i) => (i.id === id ? { ...i, messages: (i.messages || 0) + 1, last_from: 'user',
      status: resp?.reopened ? 'open' : i.status } : i);
    setIssues((list) => list.map(patch));
    setChatIssue((c) => (c ? patch(c) : c));
  };
  const [refItems, setRefItems] = useState(null); // null = not loaded
  const [errors, setErrors] = useState({});

  const flash = (msg, type = 'success') => {
    setToast(msg);
    setToastType(type);
    setTimeout(() => setToast(''), 4000);
  };

  const load = useCallback(() => {
    setLoading(true);
    setLoadError('');
    Promise.all([
      api.get('/support/contacts'),
      api.get('/support/issues'),
    ])
      .then(([cRes, iRes]) => {
        const cOk = cRes.data?.bool;
        const iOk = iRes.data?.bool;
        if (cOk) setContacts(cRes.data.response?.contacts || []);
        else setContacts([]);
        if (iOk) setIssues(iRes.data.response?.issues || []);
        else setIssues([]);
        if (!cOk && !iOk) {
          setLoadError(cRes.data?.response?.message || 'Could not load Help & support.');
        }
      })
      .catch(() => {
        setContacts([]);
        setIssues([]);
        setLoadError('Could not load Help & support. Check your connection and try again.');
      })
      .finally(() => setLoading(false));
  }, [api]);

  useEffect(() => { load(); }, [load]);

  const visible = useMemo(() => {
    if (filter === 'all') return issues;
    return issues.filter((i) => i.status === filter);
  }, [issues, filter]);

  const set = (k, v) => setForm((s) => ({ ...s, [k]: v }));
  const needsProof = PROOF_REQUIRED.includes(form.category);

  // The person's own payments / payouts for the picked category.
  useEffect(() => {
    if (!PICK_LABEL[form.category]) { setRefItems(null); return; }
    let live = true;
    setRefItems(null);
    api.get('/support/my-references', { category: form.category })
      .then(({ data }) => {
        if (!live) return;
        setRefItems(data.bool ? data.response.items || [] : []);
        setForm((f) => ({ ...f, reference_type: data.bool ? data.response.reference_type || '' : '', reference_id: '' }));
      })
      .catch(() => live && setRefItems([]));
    return () => { live = false; };
  }, [api, form.category]);

  const uploadProof = async (file, { onProgress, signal }) => {
    const fd = new FormData();
    fd.append('file', file);
    const up = await api.upload('/upload/', fd, { onProgress, signal });
    if (!up.data.bool) throw new Error(up.data.response?.message || 'Upload failed.');
    setProof((p) => [...p, { url: up.data.response.url, name: up.data.response.original_name || file.name }].slice(0, MAX_PROOF));
  };

  const submit = async (e) => {
    e.preventDefault();
    const parsed = supportIssue.safeParse(form);
    const next = fieldErrors(parsed);
    setErrors(next);
    if (!parsed.success) return;
    if (needsProof && proof.length === 0) {
      setErrors((e) => ({ ...e, proof: 'Attach a screenshot or PDF as proof.' }));
      return;
    }
    setSending(true);
    try {
      const payload = {
        ...parsed.data,
        contact_email: userEmail || undefined,
        source,
        reference_type: form.reference_id ? form.reference_type : undefined,
        reference_id: form.reference_id || undefined,
        txn_ref: form.txn_ref.trim() || undefined,
        attachments: proof,
      };
      const { data } = await api.post('/support/issues/raise', payload);
      if (data.bool) {
        setForm({ category: '', subject: '', body: '', reference_type: '', reference_id: '', txn_ref: '' });
        setProof([]);
        setIssues((prev) => [data.response.issue, ...prev]);
        flash('Issue sent. We will update the status here.');
      } else {
        flash(data.response?.message || 'Could not send the issue.', 'error');
      }
    } catch {
      flash('Could not send the issue. Try again.', 'error');
    } finally {
      setSending(false);
    }
  };

  return (
    <Wrap className="space-y-6 sm:space-y-8">
      <Toast message={toast} type={toastType} />
      <SupportChatPanel issue={chatIssue} api={api} base="/support/issues" role="user"
                        onClose={() => setChatIssue(null)} onSent={afterSend} />
      <PageHeader
        title="Help & support"
        subtitle="Email or call us, or raise an issue in the app so we can mark it solved."
      />

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-28 bg-white border border-slate-100 rounded-2xl animate-pulse" />
          ))}
        </div>
      ) : loadError ? (
        <LoadError what="Help & support" message={loadError} onRetry={load} />
      ) : (
        <>
          <section>
            <div className="flex items-center gap-2 mb-3">
              <LifeBuoy size={16} style={{ color: 'var(--accent)' }} />
              <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wide">Talk to us</h2>
            </div>
            {contacts.length === 0 ? (
              <Card className="p-6">
                <EmptyState
                  icon={LifeBuoy}
                  title="Support contacts are being set"
                  subtitle="Email and call details will appear here once Admin adds them. You can still raise an issue below."
                />
              </Card>
            ) : (
              // Columns follow the number of channels: a fixed xl:3 gave two
              // contacts a third of the row each and cut the email short.
              <div className={`grid gap-3 ${contacts.length >= 3 ? 'sm:grid-cols-2 xl:grid-cols-3' : contacts.length === 2 ? 'sm:grid-cols-2' : ''}`}>
                {contacts.map((c) => (
                  <ContactCard key={c.id} c={c} email={userEmail} />
                ))}
              </div>
            )}
          </section>

          <div className="grid gap-6 lg:grid-cols-5">
            <section className="lg:col-span-3">
              <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wide mb-3">Raise an issue</h2>
              <Card className="p-4 sm:p-6">
                <form onSubmit={submit} className="space-y-4" noValidate>
                  <div>
                    <p className="text-xs font-semibold text-slate-500 mb-2">Category</p>
                    <div className="grid grid-cols-3 sm:flex sm:flex-wrap gap-2" role="group" aria-label="Issue category">
                      {categories.map((c) => {
                        const on = form.category === c.value;
                        return (
                          <button
                            key={c.value}
                            type="button"
                            onClick={() => set('category', c.value)}
                            aria-pressed={on}
                            className={`px-1.5 sm:px-3 py-2 min-h-11 rounded-xl text-xs font-semibold border transition-colors ${
                              on ? 'text-white border-transparent' : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'
                            }`}
                            style={on ? { backgroundColor: 'var(--accent)' } : undefined}
                          >
                            {c.label}
                          </button>
                        );
                      })}
                    </div>
                    {errors.category && <p className="text-xs text-red-500 mt-1">{errors.category}</p>}
                  </div>

                  <Input
                    label="Subject"
                    required
                    value={form.subject}
                    onChange={(e) => set('subject', e.target.value)}
                    error={errors.subject}
                    maxLength={200}
                    placeholder="e.g. Refund not received"
                  />
                  <Textarea
                    label="What happened"
                    required
                    rows={5}
                    value={form.body}
                    onChange={(e) => set('body', e.target.value)}
                    error={errors.body}
                    maxLength={4000}
                    placeholder="Tell us what went wrong and any order or booking details you have."
                  />

                  {PICK_LABEL[form.category] && (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <FormSelect
                        label={PICK_LABEL[form.category]}
                        value={form.reference_id}
                        onChange={(v) => set('reference_id', v || '')}
                        placeholder={refItems === null ? 'Loading…' : refItems.length ? 'Pick one (optional)' : 'None found'}
                        options={(refItems || []).map((o) => ({ value: o.id, label: o.label }))}
                      />
                      <Input
                        label="UTR / transaction ID"
                        value={form.txn_ref}
                        onChange={(e) => set('txn_ref', e.target.value)}
                        maxLength={80}
                        placeholder="Optional, from your bank or UPI app"
                      />
                    </div>
                  )}

                  {form.category && (
                    <div>
                      <p className="text-xs font-semibold text-slate-500 mb-2">
                        Proof {needsProof ? <span className="text-red-500">*</span> : <span className="font-normal">(optional)</span>}
                        <span className="font-normal text-slate-400"> · screenshot or PDF, up to {MAX_PROOF}</span>
                      </p>
                      {proof.length > 0 && (
                        <ul className="space-y-1.5 mb-2">
                          {proof.map((f, i) => (
                            <li key={f.url} className="flex items-center gap-2 text-xs rounded-lg border border-slate-200 px-3 py-2">
                              <CheckCircle2 size={13} className="text-emerald-600 shrink-0" />
                              <span className="truncate min-w-0 flex-1">{f.name}</span>
                              <button type="button" onClick={() => setProof((p) => p.filter((_, k) => k !== i))}
                                      className="text-slate-400 hover:text-red-500 font-semibold min-h-8 px-2">Remove</button>
                            </li>
                          ))}
                        </ul>
                      )}
                      {proof.length < MAX_PROOF && (
                        <FilePicker key={proof.length} onUpload={uploadProof}
                                    label={needsProof ? 'Upload proof' : 'Upload a screenshot'}
                                    hint={form.category === 'payouts' ? 'Bank statement for those dates' : form.category === 'payments' ? 'UPI or bank debit showing amount, date and ID' : undefined} />
                      )}
                      {errors.proof && <p className="text-xs text-red-500 mt-1">{errors.proof}</p>}
                    </div>
                  )}

                  {/* Own row, right-aligned: inline it sat flush against the
                      "Link a payment…" link with no gap. */}
                  <div className="flex justify-end pt-2 border-t border-slate-100">
                  <Button type="submit" disabled={sending || (needsProof && proof.length === 0)} className="w-full sm:w-auto min-h-11">
                    {sending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
                    {sending ? 'Sending…' : 'Send issue'}
                  </Button>
                  </div>
                </form>
              </Card>
            </section>

            <section className="lg:col-span-2">
              <div className="flex items-center justify-between gap-2 mb-3">
                <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wide">Your issues</h2>
                {issues.some((i) => i.status === 'solved') && (
                  <span className="text-[11px] text-slate-400 inline-flex items-center gap-1">
                    <CheckCircle2 size={11} /> Search finds solved rows later
                  </span>
                )}
              </div>
              {/* Same tab bar as every other screen (was a row of round chips). */}
              <Tabs className="mb-3" active={filter} onChange={setFilter} tabs={[
                { key: 'all', label: 'All', icon: Inbox },
                { key: 'open', label: 'Open', icon: CircleDot },
                { key: 'in_progress', label: 'In progress', icon: Clock3 },
                { key: 'solved', label: 'Solved', icon: CheckCircle2 },
              ]} />
              {visible.length === 0 ? (
                <Card className="p-4">
                  <EmptyState
                    icon={Send}
                    title={filter === 'all' ? 'No issues yet' : 'Nothing in this status'}
                    subtitle={filter === 'all'
                      ? 'When you send one, the status lands here.'
                      : 'Try another filter, including Solved.'}
                  />
                </Card>
              ) : (
                <div className="space-y-2">
                  {visible.map((issue) => (
                    <IssueRow key={issue.id} issue={issue} onOpenChat={setChatIssue} api={api} onChanged={load} />
                  ))}
                </div>
              )}
            </section>
          </div>
        </>
      )}
    </Wrap>
  );
}
