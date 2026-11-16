import useCompany from '../../hooks/useCompany';
import React, { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, Mail, FileText, Shield, RotateCcw, IndianRupee, ArrowUp, CalendarClock } from 'lucide-react';
import { Tabs } from '../../components/admin/v1/AdminV1Kit';
import { val, isPlaceholder, POLICY_LINKS } from '../../config/company';

/**
 * The shell every policy page shares: a minimal signed-out header, the legal
 * footer nav, and the typographic frame for long-form legal copy.
 *
 * These pages are reachable without a session on purpose — Cashfree and AWS SES
 * both fetch them during review, and a policy behind a login is a policy they
 * cannot read. There is deliberately no app chrome (no sidebar, no auth guard).
 */

/** Renders a company field, marking it visibly when it is still a placeholder so
 *  an unconfirmed detail can never masquerade as final in a legal document. */
export function Field({ field }) {
  const text = val(field);
  if (isPlaceholder(field)) {
    return (
      <span className="text-slate-500">
        {text}
        {' '}<span className="no-underline inline-block align-middle px-1.5 py-0.5 rounded-md bg-slate-100 text-slate-500 text-[11px] font-semibold whitespace-nowrap">To confirm</span>
      </span>
    );
  }
  return <span>{text}</span>;
}

const ICONS = { '/terms': FileText, '/privacy': Shield, '/refund': RotateCcw, '/pricing': IndianRupee, '/contact': Mail };
const SHORT = { '/terms': 'Terms', '/privacy': 'Privacy', '/refund': 'Refunds', '/pricing': 'Pricing', '/contact': 'Contact' };

export default function PolicyLayout({ title, updated, children }) {
  const { company: COMPANY } = useCompany();
  useEffect(() => {
    document.title = `${title} · SKOVO`;
  }, [title]);

  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [showTop, setShowTop] = useState(false);
  useEffect(() => {
    const onScroll = () => setShowTop(window.scrollY > 600);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <div className="min-h-screen bg-white text-slate-800">
      {/* Header */}
      <header className="border-b border-slate-100">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 sm:px-6 py-3">
          <Link to="/" className="flex items-center gap-2.5">
            <div className="h-8 w-8 overflow-hidden rounded-lg shadow-sm">
              <img src="/skovo-logo-black.jpg" alt="SKOVO" className="h-full w-full object-cover" />
            </div>
            <span className="text-lg font-black tracking-tight text-slate-900">SKOVO</span>
          </Link>
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 min-h-10 text-sm font-medium text-slate-500 transition-colors hover:text-slate-900"
          >
            <ArrowLeft size={15} /> Back to home
          </Link>
        </div>
      </header>

      {/* Title band */}
      <section className="relative overflow-hidden border-b border-slate-100 bg-slate-50">
        <div className="absolute -top-24 right-0 w-96 h-96 rounded-full bg-violet-500/10 blur-3xl pointer-events-none" />
        <div className="relative mx-auto max-w-6xl px-4 sm:px-6 pt-8 sm:pt-12 pb-6">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-violet-100 text-violet-700 text-[11px] font-bold uppercase tracking-widest">
            {React.createElement(ICONS[pathname] || FileText, { size: 12 })} Legal
          </span>
          <h1 className="mt-3 text-[1.75rem] sm:text-4xl font-black tracking-tight text-slate-900">{title}</h1>
          {updated && (
            <p className="mt-2 inline-flex items-center gap-1.5 text-sm text-slate-500">
              <CalendarClock size={14} /> Last updated {updated}
            </p>
          )}
          <div className="mt-6">
            <Tabs active={pathname} onChange={(to) => navigate(to)}
                  tabs={POLICY_LINKS.map(({ to, label }) => ({ key: to, label: SHORT[to] || label, icon: ICONS[to] || FileText }))} />
          </div>
        </div>
      </section>

      {/* Document */}
      <main className="mx-auto max-w-6xl px-4 sm:px-6 py-8 sm:py-10">


        <article className="policy-card">
          <div className="policy-prose">{children}</div>
        </article>
      </main>

      {showTop && (
        <button type="button" aria-label="Back to top" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
                className="fixed bottom-5 right-5 z-40 w-11 h-11 rounded-full bg-[#7C3AED] hover:bg-[#8B5CF6] text-white shadow-lg shadow-violet-900/30 flex items-center justify-center">
          <ArrowUp size={18} />
        </button>
      )}

      {/* Footer */}
      <footer className="border-t border-slate-100 bg-slate-50">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-10">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
            <nav className="flex flex-wrap gap-x-5">
              {POLICY_LINKS.map(({ to, label }) => (
                <Link key={to} to={to} className="inline-flex items-center min-h-10 text-sm text-slate-500 transition-colors hover:text-slate-900">
                  {label}
                </Link>
              ))}
            </nav>
            <a
              href={`mailto:${val(COMPANY.supportEmail)}?subject=${encodeURIComponent('SKOVO support request')}`}
              className="inline-flex items-center gap-2 min-h-10 text-sm text-slate-500 transition-colors hover:text-slate-900"
            >
              <Mail size={14} /> {val(COMPANY.supportEmail)}
            </a>
          </div>
          <p className="mt-6 text-xs text-slate-400">
            &copy; {new Date().getFullYear()} {val(COMPANY.brand)}. All rights reserved.
          </p>
        </div>
      </footer>

      {/* Long-form legal typography — scoped to these pages only. */}
      <style>{`
        .policy-prose { color: #334155; line-height: 1.7; font-size: 0.975rem; }
        .policy-prose h2 { scroll-margin-top: 1.5rem; margin-top: 2rem; padding-top: 1.25rem; border-top: 1px solid #f1f5f9; margin-bottom: 0.6rem; font-size: 1.2rem; font-weight: 800; color: #0f172a; }
        .policy-prose > h2:first-child { margin-top: 0; padding-top: 0; border-top: 0; }
        .policy-prose h3 { margin-top: 1.4rem; margin-bottom: 0.4rem; font-size: 1.02rem; font-weight: 700; color: #1e293b; }
        .policy-prose p { margin: 0.7rem 0; }
        .policy-prose ul { margin: 0.7rem 0; padding-left: 1.25rem; list-style: disc; }
        .policy-prose ol { margin: 0.7rem 0; padding-left: 1.25rem; list-style: decimal; }
        .policy-prose li { margin: 0.35rem 0; }
        .policy-prose a { color: #6d28d9; text-decoration: underline; text-underline-offset: 2px; }
        .policy-prose strong { color: #0f172a; font-weight: 700; }
        /* Dark theme: the colours above are literals, so the global dark remap
           never reached them — headings and bold terms vanished on the dark page. */
        /* Document card: plain on phones, a card from 640px. Written here because
           the dark remap only reaches plain bg-white, not sm:bg-white. */
        @media (min-width: 640px) {
          .policy-card { background: #ffffff; border: 1px solid #e2e8f0; border-radius: 1.5rem; padding: 2rem; }
          html.dark .policy-card { background: #0f172a; border-color: #334155; }
        }
        html.dark .policy-prose { color: #cbd5e1; }
        html.dark .policy-prose h2 { color: #f8fafc; border-top-color: rgba(255,255,255,0.06); }
        html.dark .policy-prose h3 { color: #e2e8f0; }
        html.dark .policy-prose strong { color: #f1f5f9; }
        html.dark .policy-prose a { color: #c4b5fd; }
      `}</style>
    </div>
  );
}
