import React, { useEffect, useState, useCallback } from 'react';
import { Button as KitButton } from '../../components/ui/index.jsx';
import { z } from 'zod';
import { adminApi as api } from '../../services/api';
import { Mail, Plus, X, Copy, Check, Ban, Clock, UserCheck, AlertCircle, MessageSquare, ShieldCheck, Eye } from 'lucide-react';
import { Th, Td, TableShell, Pagination, ActionBtn, ConfirmModal } from '../../components/ui/TableComponents';
import { FormSelect } from '../../components/ui/index.jsx';
import { useMasters } from '../../hooks/useMasters';

function InviteDetailModal({ item: inv, onClose, onRevoke }) {
  if (!inv) return null;
  const fmt = (iso) => iso ? new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
  const rows = [
    { label: 'Email', value: inv.email || '—' },
    { label: 'Role', value: inv.role_code || '—' },
    { label: 'Status', value: inv.status || '—' },
    { label: 'Invited By', value: inv.invited_by_email || '—' },
    { label: 'Expires', value: fmt(inv.expires_at) },
  ];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 className="text-base font-bold text-slate-900">Invitation Details</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"><X size={18} /></button>
        </div>
        <div className="px-6 py-5">
          <div className="space-y-1">
            {rows.map(({ label, value }) => (
              <div key={label} className="flex items-center justify-between py-2 border-b border-slate-50">
                <span className="text-xs text-slate-400 font-medium w-28 shrink-0">{label}</span>
                <span className="text-sm font-semibold text-slate-800 text-right capitalize">{value}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="px-6 pb-5 flex gap-3">
          {onRevoke && inv.status === 'pending' && (
            <button onClick={() => { onRevoke(inv); onClose(); }} className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-red-50 text-red-600 hover:bg-red-100 transition-colors">Revoke</button>
          )}
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors">Close</button>
        </div>
      </div>
    </div>
  );
}

const inviteSchema = z.object({
  email:   z.string().email('Please enter a valid email address'),
  message: z.string().optional(),
});

const STATUS_STYLE = {
  pending:  'bg-blue-100 text-blue-700',
  accepted: 'bg-emerald-100 text-emerald-700',
  revoked:  'bg-red-100 text-red-700',
  expired:  'bg-slate-100 text-slate-500',
};

function Toast({ msg, ok }) {
  if (!msg) return null;
  return (
    <div className={`fixed bottom-6 right-6 z-100 px-5 py-3 rounded-2xl text-sm font-semibold shadow-2xl flex items-center gap-2 ${ok ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'}`}>
      {ok ? <Check size={15} /> : <X size={15} />} {msg}
    </div>
  );
}

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button onClick={copy} className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-all" title="Copy link">
      {copied ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
    </button>
  );
}

/* Mobile card for a single invitation */
function InviteCard({ inv, onRevoke }) {
  const fmt = (iso) => iso ? new Date(iso).toLocaleDateString('en-IN', { dateStyle: 'medium' }) :  '—';
  const inviteLink = `${window.location.origin}/invite/${inv.token}`;
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-slate-900 text-sm truncate">{inv.email}</p>
          {inv.invited_by_email && (
            <p className="text-xs text-slate-400 mt-0.5">By {inv.invited_by_email}</p>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${inv.role_code === 'admin' ? 'bg-amber-100 text-amber-700' : 'bg-purple-100 text-purple-700'}`}>
            {inv.role_code}
          </span>
          <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${STATUS_STYLE[inv.status] || 'bg-slate-100 text-slate-500'}`}>
            {inv.status}
          </span>
        </div>
      </div>

      <div className="flex items-center justify-between pt-2 border-t border-slate-100">
        <span className="flex items-center gap-1.5 text-xs text-slate-400">
          <Clock size={11} /> Expires {fmt(inv.expires_at)}
        </span>
        {inv.status === 'pending' && (
          <div className="flex items-center gap-1">
            <CopyButton text={inviteLink} />
            <button onClick={() => onRevoke(inv)}
              className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all" title="Revoke">
              <Ban size={14} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function AdminInvites() {
  const { lists } = useMasters(['invite_role']);
  const [invites,     setInvites]     = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [page,        setPage]        = useState(1);
  const [pages,       setPages]       = useState(1);
  const [toast,       setToast]       = useState(null);
  const [showForm,    setShowForm]    = useState(false);
  const [sending,     setSending]     = useState(false);
  const [newInvite,   setNewInvite]   = useState({ email: '', role_code: 'mentor', message: '' });
  const [inviteErrors, setInviteErrors] = useState({});
  const [createdLink, setCreatedLink] = useState(null);
  const [view, setView] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [perPage, setPerPage] = useState(15);
  const [total, setTotal] = useState(0);

  const showToast = (msg, ok = true) => { setToast({ msg, ok }); setTimeout(() => setToast(null), 3500); };

  const load = useCallback((p = 1, pp = perPage) => {
    setLoading(true);
    api.get('/skovo-platform-panel-admin/invites', { page: p, per_page: pp })
      .then(({ data }) => {
        if (data.bool) {
          setInvites(data.response.invites);
          setPages(data.pagination?.pages || 1);
          setTotal(data.pagination?.total || (data.response.invites || []).length);
        }
      }).catch(() => {}).finally(() => setLoading(false));
  }, [perPage]);

  useEffect(() => { load(1); }, []);

  const send = async (e) => {
    e.preventDefault();
    const result = inviteSchema.safeParse(newInvite);
    if (!result.success) { setInviteErrors(result.error.flatten().fieldErrors); return; }
    setInviteErrors({});
    setSending(true);
    try {
      const { data } = await api.post('/skovo-platform-panel-admin/invites', newInvite);
      if (data.bool) {
        const token = data.response.token_url;
        setCreatedLink(`${window.location.origin}/invite/${token}`);
        setNewInvite({ email: '', role_code: 'mentor', message: '' });
        load(page);
      } else {
        showToast(data.response?.message || 'Failed', false);
      }
    } catch { showToast('Error sending invite', false); }
    finally { setSending(false); }
  };

  const revoke = async (id) => {
    try {
      const { data } = await api.delete(`/skovo-platform-panel-admin/invites/${id}`);
      if (data.bool) { showToast('Invitation revoked'); load(page); }
      else showToast(data.response?.message || 'Failed', false);
    } catch { showToast('Error', false); }
  };

  return (
    <div className="p-4 sm:p-6">
      <Toast msg={toast?.msg} ok={toast?.ok} />

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-5">
        <div>
          <h1 className="text-2xl font-black text-slate-900">Invitations</h1>
          <p className="text-sm text-slate-500 mt-0.5"><span className="font-semibold text-slate-700">{total}</span> invite links for mentors and admins</p>
        </div>
        <KitButton onClick={() => { setShowForm(true); setCreatedLink(null); }} className="w-full sm:w-auto">
          <Plus size={16} /> Send invite
        </KitButton>
      </div>

      {/* Send invite form */}
      {showForm && (
        <div className="bg-white border border-slate-200 rounded-2xl p-5 mb-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-bold text-slate-900">New Invitation</h2>
            <button onClick={() => { setShowForm(false); setCreatedLink(null); }}
              className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100">
              <X size={16} />
            </button>
          </div>

          {createdLink ? (
            <div className="space-y-3">
              <div className="flex items-start gap-3 p-4 bg-emerald-50 border border-emerald-200 rounded-xl">
                <UserCheck size={18} className="text-emerald-600 shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-emerald-800 mb-1">Invite link created!</p>
                  <p className="text-xs text-emerald-700 font-mono break-all">{createdLink}</p>
                </div>
                <CopyButton text={createdLink} />
              </div>
              <p className="text-xs text-slate-500">Share this link with the person. It expires in 7 days and can only be used once.</p>
              <button onClick={() => setCreatedLink(null)}
                className="text-sm font-semibold text-blue-600 hover:underline">Send another ←'</button>
            </div>
          ) : (
            <form onSubmit={send} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 mb-1.5">
                    <Mail size={12} className="text-slate-400"/> Email address <span className="text-red-500">*</span>
                  </label>
                  <div className="relative">
                    <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"/>
                    <input type="email" value={newInvite.email}
                      onChange={(e) => { setNewInvite((p) => ({ ...p, email: e.target.value })); setInviteErrors(e2 => ({...e2, email: undefined})); }}
                      placeholder="mentor@example.com"
                      className={`w-full pl-9 pr-4 py-2.5 border rounded-xl text-sm focus:outline-none ${inviteErrors.email?.[0] ? 'border-red-400 bg-red-50/30 focus:ring-red-100' : 'border-slate-200 focus:ring-blue-500'}`} />
                  </div>
                  {inviteErrors.email?.[0] && <p className="text-xs text-red-500 mt-1 flex items-center gap-1"><AlertCircle size={10}/>{inviteErrors.email[0]}</p>}
                </div>
                <div>
                  <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 mb-1.5">
                    <ShieldCheck size={12} className="text-slate-400"/> Role
                  </label>
                  <FormSelect searchType="invite_role"
                    value={newInvite.role_code}
                    onChange={v => setNewInvite((p) => ({ ...p, role_code: v }))}
                    icon={ShieldCheck}
                    options={lists.invite_role || []}
                    clearable={false} />
                </div>
              </div>
              <div>
                <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 mb-1.5">
                  <MessageSquare size={12} className="text-slate-400"/> Personal message <span className="text-slate-400 font-normal ml-1">(optional)</span>
                </label>
                <div className="relative">
                  <MessageSquare size={14} className="absolute left-3 top-3 text-slate-400 pointer-events-none"/>
                  <textarea rows={2} value={newInvite.message}
                    onChange={(e) => setNewInvite((p) => ({ ...p, message: e.target.value }))}
                    placeholder="Hi! We'd love for you to join SKOVO as a mentor and inspire the next generation of students…"
                    className="w-full pl-9 pr-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
                </div>
              </div>
              <div className="flex justify-end gap-3 pt-1">
                <button type="button" onClick={() => setShowForm(false)}
                  className="px-5 py-2.5 text-sm font-semibold border border-slate-200 rounded-xl hover:bg-slate-50">Cancel</button>
                <button type="submit" disabled={sending}
                  className="flex items-center gap-2 px-5 py-2.5 text-sm font-semibold bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:opacity-50">
                  <Mail size={14} /> {sending ? 'Creating…' : 'Create Invite Link'}
                </button>
              </div>
            </form>
          )}
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-14 bg-white rounded-2xl border border-slate-100 animate-pulse" />
          ))}
        </div>
      ) : invites.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 flex flex-col items-center py-20">
          <Mail size={40} className="mb-3 text-slate-300" />
          <p className="font-semibold text-slate-500">No invitations sent yet</p>
        </div>
      ) : (
        <>
          {/* Mobile cards */}
          <div className="lg:hidden grid grid-cols-1 md:grid-cols-2 gap-3">
            {invites.map((inv) => (
              <InviteCard key={inv.id} inv={inv} onRevoke={setConfirm} />
            ))}
            <div className="md:col-span-2">
              <Pagination page={page} pages={pages} total={total} perPage={perPage}
                          onPage={(p) => { setPage(p); load(p, perPage); }}
                          onPerPage={(pp) => { setPerPage(pp); setPage(1); load(1, pp); }} />
            </div>
          </div>

          {/* Desktop table */}
          <div className="hidden lg:block">
            <TableShell>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      <Th>Email</Th>
                      <Th>Role</Th>
                      <Th>Invited By</Th>
                      <Th>Status</Th>
                      <Th>Expires</Th>
                      <Th>Actions</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 mo-stagger-fade">
                    {invites.map((inv) => (
                      <tr key={inv.id} onClick={() => setView(inv)} className="hover:bg-slate-50 transition-colors cursor-pointer">
                        <Td className="font-medium text-slate-900">{inv.email}</Td>
                        <Td>
                          <span className={`text-xs font-semibold px-2.5 py-1 rounded-full capitalize ${inv.role_code === 'admin' ? 'bg-amber-100 text-amber-700' : 'bg-purple-100 text-purple-700'}`}>
                            {inv.role_code}
                          </span>
                        </Td>
                        <Td className="text-slate-500 text-xs">{inv.invited_by_email || '—'}</Td>
                        <Td>
                          <span className={`text-xs font-semibold px-2.5 py-1 rounded-full capitalize ${STATUS_STYLE[inv.status] || ''}`}>
                            {inv.status}
                          </span>
                        </Td>
                        <Td className="text-slate-400 text-xs whitespace-nowrap">
                          <span className="flex items-center gap-1">
                            <Clock size={11} />
                            {inv.expires_at ? new Date(inv.expires_at).toLocaleDateString('en-IN', { dateStyle: 'medium' }) :  '—'}
                          </span>
                        </Td>
                        <Td>
                          <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                            <ActionBtn icon={Eye} tooltip="View" color="indigo" onClick={() => setView(inv)} />
                            {inv.status === 'pending' && (
                              <>
                                <CopyButton text={`${window.location.origin}/invite/${inv.token}`} />
                                <ActionBtn icon={Ban} tooltip="Revoke" color="red" onClick={() => setConfirm(inv)} />
                              </>
                            )}
                          </div>
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination
                page={page}
                pages={pages}
                total={total}
                perPage={perPage}
                onPage={(p) => { setPage(p); load(p, perPage); }}
                onPerPage={(pp) => { setPerPage(pp); setPage(1); load(1, pp); }}
              />
            </TableShell>
          </div>
        </>
      )}

      {view && <InviteDetailModal item={view} onClose={() => setView(null)} onRevoke={(inv) => setConfirm(inv)} />}

      {confirm && (
        <ConfirmModal
          message="Revoke this invitation?"
          detail={confirm.email}
          danger
          confirmLabel="Revoke"
          onConfirm={() => { revoke(confirm.id); setConfirm(null); }}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  );
}
