import React from 'react';
import { Clock, AlertTriangle, LogOut, Mail } from 'lucide-react';
import { Card, Button } from '../../components/ui/index.jsx';

/**
 * What an admin sees before they are approved, or after being suspended.
 *
 * The whole console, replaced. Not a banner over a working dashboard — a
 * pending admin must not see students, achievers or money, and hiding those
 * behind a banner is one CSS mistake away from showing them.
 *
 * They can still sign in, which is deliberate: an account that simply refuses
 * the login leaves someone unable to tell whether their registration was
 * received at all.
 */
export default function AdminHoldingScreen({ state, guidelines, reason, onSignOut }) {
  const suspended = state === 'suspended';
  const Icon = suspended ? AlertTriangle : Clock;

  const tone = suspended
    ? { bg: 'bg-orange-50', border: 'border-orange-200', text: 'text-orange-900', icon: 'text-orange-600' }
    : { bg: 'bg-blue-50',   border: 'border-blue-200',   text: 'text-blue-900',   icon: 'text-blue-600' };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="w-full max-w-xl space-y-4">
        <div className="text-center mb-2">
          <div className="w-12 h-12 rounded-2xl overflow-hidden mx-auto mb-3 shadow-sm">
            <img src="/skovo-logo-black.jpg" alt="Skovo" className="w-full h-full object-cover" />
          </div>
          <p className="text-sm font-semibold text-slate-500">SKOVO Admin</p>
        </div>

        <Card className={`p-6 ${tone.bg} ${tone.border}`}>
          <div className="flex items-start gap-4">
            <Icon size={24} className={`${tone.icon} shrink-0 mt-0.5`} />
            <div className="min-w-0">
              <h1 className={`text-lg font-bold ${tone.text}`}>
                {guidelines?.title || 'Your account is awaiting approval'}
              </h1>
              <p className="text-sm text-slate-600 mt-1.5">
                {guidelines?.summary}
              </p>

              {/* The admin's own words from whoever decided. A suspension with
                  no stated reason is the one that gets escalated. */}
              {reason && (
                <div className="mt-4 rounded-xl bg-white border border-white/70 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                    Reason
                  </p>
                  <p className="text-sm text-slate-800 mt-1">{reason}</p>
                </div>
              )}

              {Array.isArray(guidelines?.steps) && guidelines.steps.length > 0 && (
                <ol className="mt-4 space-y-2">
                  {guidelines.steps.map((s, i) => (
                    <li key={i} className="flex gap-2.5 text-sm text-slate-700">
                      <span className="text-slate-400 shrink-0 font-semibold">{i + 1}.</span>
                      <span>{s}</span>
                    </li>
                  ))}
                </ol>
              )}

              {guidelines?.note && (
                <p className="text-xs text-slate-500 mt-4 italic">{guidelines.note}</p>
              )}
            </div>
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-3 text-sm text-slate-600">
            <Mail size={16} className="text-slate-400 shrink-0" />
            <span>
              Need this looked at? Contact whoever manages the platform — only a
              super-admin can approve an admin account.
            </span>
          </div>
        </Card>

        <div className="flex justify-center">
          <Button variant="ghost" onClick={onSignOut}>
            <LogOut size={15} className="mr-1.5" /> Sign out
          </Button>
        </div>
      </div>
    </div>
  );
}
