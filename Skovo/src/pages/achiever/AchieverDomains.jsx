import React, { useEffect, useState, useRef } from 'react';
import { Tag, Plus, AlertCircle, Loader2, X, Search, ChevronDown } from 'lucide-react';
import { achieverApi } from '../../services/api';
import { ErrorState, useToast } from '../../components/ui/index.jsx';
import * as schema from '../../schemas/achiever';
import { fieldErrors } from '../../schemas/achiever';

function AddDomainModal({ domains, onClose, onAdded }) {
  const [name,    setName]    = useState('');
  const [adding,  setAdding]  = useState(false);
  const [error,   setError]   = useState('');
  const inputRef = useRef(null);

  useEffect(() => { setTimeout(() => inputRef.current?.focus(), 50); }, []);

  const trimmed = name.trim();

  // Compared on a normalised key: in a list everyone shares, "Back-End",
  // "back end" and "Backend" are one category, and admitting all three is how a
  // taxonomy stops being useful. The server checks this too — this is only so
  // the answer is instant.
  const key = (v) => (v || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const duplicate = domains.find(d => key(d.name) === key(trimmed));

  const submit = async (e) => {
    e.preventDefault();
    const parsed = schema.domain.safeParse({ name: trimmed });
    if (!parsed.success) {
      setError(Object.values(fieldErrors(parsed))[0] || 'Enter a domain name.');
      return;
    }

    // Already there: say so and close, rather than leaving them staring at a
    // form with nothing to do.
    if (duplicate) {
      onAdded(`"${duplicate.name}" is already in the list.`, 'warn');
      onClose();
      return;
    }

    setAdding(true); setError('');
    try {
      const { data } = await achieverApi.post('/achievers/portal/domains', { name: trimmed });
      if (data.bool) {
        onAdded(data.response?.message || `"${trimmed}" added.`, 'ok');
        onClose();
      } else {
        // The server catches duplicates this client could not see — e.g. one
        // added by another achiever since this page loaded.
        onAdded(data.response?.message || 'Could not add domain.', 'warn');
        onClose();
      }
    } catch {
      setError('Connection error. Try again.');
      setAdding(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <form onSubmit={submit}
            className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h2 className="font-bold text-slate-900">Add a domain</h2>
          <button type="button" onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100">
            <X size={16} />
          </button>
        </div>

        <div className="px-5 py-5">
          <label htmlFor="domain-name" className="block text-xs font-semibold text-slate-600 mb-1">
            Domain name <span className="text-red-500">*</span>
          </label>
          <input
            id="domain-name"
            ref={inputRef}
            value={name}
            onChange={e => { setName(e.target.value); setError(''); }}
            onKeyDown={e => { if (e.key === 'Escape') onClose(); }}
            placeholder="e.g. Cybersecurity"
            maxLength={100}
            className={`w-full px-3.5 py-2.5 text-sm border rounded-xl bg-white
                        focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500
                        ${error ? 'border-red-300' : 'border-slate-200'}`}
          />

          {error ? (
            <p className="mt-2 text-xs text-red-500 flex items-center gap-1">
              <AlertCircle size={11} /> {error}
            </p>
          ) : (
          <p className="text-xs text-slate-400">
            Added to the shared list immediately. Matching names (any capitalisation) are not duplicated.
          </p>
          )}
        </div>

        <div className="flex items-center gap-2 px-5 py-4 border-t border-slate-100">
          <button type="button" onClick={onClose}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-slate-600 hover:bg-slate-50">
            Cancel
          </button>
          <button type="submit" disabled={adding || !trimmed}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold
                       text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-40
                       disabled:cursor-not-allowed transition-colors">
            {adding ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
            {adding ? 'Adding…' : 'Add domain'}
          </button>
        </div>
      </form>
    </div>
  );
}

export default function AchieverDomains() {
  const [domains,    setDomains]    = useState([]);
  const [tree,       setTree]       = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [showModal,  setShowModal]  = useState(false);
  const [search,     setSearch]     = useState('');
  const [failed,     setFailed]     = useState(false);
  const [reloadKey,  setReloadKey]  = useState(0);
  const [openId,     setOpenId]     = useState(null);
  // A duplicate name is a normal outcome, not an error to bury in the form -
  // it gets said once, plainly, and the dialog closes. ToastProvider in
  // AchieverLayout owns the queue; this screen had its own setTimeout pair.
  const toast = useToast();

  useEffect(() => {
    let alive = true;
    achieverApi.get('/achievers/portal/domains')
      .then(({ data }) => {
        if (!alive) return;
        if (!data.bool) { setFailed(true); return; }
        setDomains(data.response.domains || []);
        setTree(data.response.tree || []);
        setFailed(false);
      })
      // Swallowed before: a failed load showed an achiever an empty domain
      // list, which reads as "you teach nothing" rather than "we could not ask".
      .catch(() => { if (alive) setFailed(true); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [reloadKey]);

  const load = () => setReloadKey((k) => k + 1);
  const retry = () => { setLoading(true); load(); };


  return (
    <div className="p-4 sm:p-6">


      {showModal && (
        <AddDomainModal
          domains={domains}
          onClose={() => setShowModal(false)}
          onAdded={(msg, tone) => {
            // 'warn' is the duplicate-name case: worth saying, not worth reloading.
            if (tone === 'warn') { toast.info(msg); return; }
            toast.success(msg);
            load();
          }}
        />
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Tag size={20} style={{ color: 'var(--accent)' }} />
            <h1 className="text-2xl font-black text-slate-900">Domains</h1>
          </div>
          <p className="text-sm text-slate-500">
            Shared labels students browse by. Add one here — it is stored with your name, no admin wait.
          </p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-white transition-all hover:opacity-90 shrink-0"
          style={{ backgroundColor: 'var(--accent)' }}
        >
          <Plus size={15} /> Suggest a domain
        </button>
      </div>

      {/* Search */}
      <div className="relative mb-4">
        <Search size={15} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search domains…"
          className="w-full pl-10 pr-4 py-2.5 border border-slate-200 rounded-xl text-sm bg-white focus:outline-none transition-shadow"
        />
        {search && (
          <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
            <X size={14} />
          </button>
        )}
      </div>

      {/* List */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100 bg-slate-50">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
            {search ? `Results for "${search}"` : `${tree.length} domains · ${domains.length - tree.length} sub-domains`}
          </p>
        </div>
        {loading ? (
          <div>{Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="px-5 py-4 h-14 animate-pulse bg-slate-50 border-b border-slate-100" />
          ))}</div>
        ) : failed ? (
          <ErrorState
            title="We couldn't load the domains"
            subtitle="The taxonomy is fine - this is a connection problem."
            onRetry={retry}
          />
        ) : (() => {
          // Searching matches a sub-domain too, and keeps its parent so the
          // result still says which domain it belongs to.
          const q = search.trim().toLowerCase();
          const hit = (n) => !q || (n || '').toLowerCase().includes(q);
          const groups = tree
            .map(p => ({
              ...p,
              children: (p.children || []).filter(c => hit(c.name) || hit(p.name)),
            }))
            .filter(p => hit(p.name) || p.children.length);

          return groups.length === 0 ? (
            <div className="flex flex-col items-center py-16 text-slate-400">
              <Search size={36} className="mb-3 text-slate-300" />
              <p className="font-semibold">{q ? `No results for "${search}"` : 'No domains yet'}</p>
              <p className="text-sm mt-1">
                {q ? 'Try a different search term' : 'Admins curate this list'}
              </p>
            </div>
          ) : (
            <div>
              {groups.map(p => (
                <div key={p.id} className="border-b border-slate-100 last:border-0">
                  {/* Collapsed by default; a search opens every match. */}
                  <button type="button" onClick={() => setOpenId(openId === p.id ? null : p.id)}
                          aria-expanded={!!q || openId === p.id}
                          className="w-full min-h-14 flex items-center gap-3 px-4 sm:px-5 py-3 text-left hover:bg-slate-50">
                    <span className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 bg-blue-50 text-blue-600 text-sm font-bold">
                      {(p.name || '?').charAt(0).toUpperCase()}
                    </span>
                    <span className="text-sm font-bold text-slate-900 flex-1 min-w-0">{p.name}</span>
                    <span className="text-xs text-slate-400 shrink-0">
                      {p.children.length || 'No'} sub-domain{p.children.length === 1 ? '' : 's'}
                    </span>
                    {p.children.length > 0 && (
                      <ChevronDown size={16} className={`text-slate-400 shrink-0 transition-transform ${(q || openId === p.id) ? 'rotate-180' : ''}`} />
                    )}
                  </button>
                  {p.children.length > 0 && (q || openId === p.id) && (
                    <div className="flex flex-wrap gap-1.5 px-4 sm:pl-16 pb-3">
                      {p.children.map(c => (
                        <span key={c.id}
                          className="text-xs font-medium text-slate-600 bg-slate-100 rounded-lg px-2.5 py-1">
                          {c.name}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          );
        })()}
      </div>
    </div>
  );
}
