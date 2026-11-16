import React from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { setReturnPath } from '../../utils/checkoutIntent';

/** Header + page for visitors who are not logged in (shared achiever links).
 *  Log in / Sign up remember this page and come back to it. */
export default function PublicShell() {
  const { pathname } = useLocation();
  const remember = () => setReturnPath(pathname);
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-30 bg-white border-b border-slate-200">
        <div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between gap-3">
          <Link to="/" className="flex items-center gap-2 min-h-11">
            <img src="/skovo-logo-blue.jpg" alt="" className="w-8 h-8 rounded-lg" />
            <span className="font-black text-slate-900">SKOVO</span>
          </Link>
          <div className="flex items-center gap-2">
            <Link to="/login" onClick={remember}
                  className="min-h-11 inline-flex items-center px-3 text-sm font-semibold text-slate-600 hover:text-slate-900">Log in</Link>
            <Link to="/signup" onClick={remember}
                  className="min-h-11 inline-flex items-center px-4 rounded-xl text-sm font-semibold text-white"
                  style={{ backgroundColor: 'var(--accent)' }}>Sign up</Link>
          </div>
        </div>
      </header>
      <main id="main-content" className="pb-10">
        <Outlet />
      </main>
    </div>
  );
}
