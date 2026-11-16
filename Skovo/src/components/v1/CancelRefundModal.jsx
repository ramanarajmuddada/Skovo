import React, { useState } from 'react';
import { Modal } from '../ui/index.jsx';

const REASONS = [['timing_clash', 'Timing clash'], ['achiever_issue', 'Problem with the achiever'], ['not_as_expected', 'Not what I expected'],
  ['changed_mind', 'Changed my mind'], ['other', 'Other']];
const rupee = (v) => `₹${Number(v || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

/**
 * Cancel with refund choice (refunds & wallet spreadsheet): pick SKOVO Wallet
 * The refund always goes to the SKOVO wallet (instant, no bonus); the student gives an optional reason.
 *   preview  the refund-preview response ({refund, text, wallet_available, wallet_amount, wallet_bonus})
 *   onConfirm({refund_to, reason_code, reason_text})
 */
export default function CancelRefundModal({ title, preview, confirmLabel = 'Cancel', onConfirm, onClose }) {
  const refund = Number(preview?.refund || 0);
  const to = 'wallet';  // v1: every refund goes to the SKOVO wallet
  const [code, setCode] = useState('');
  const [reasonText, setReasonText] = useState('');
  const [busy, setBusy] = useState(false);

  const go = async () => {
    setBusy(true);
    try { await onConfirm({ refund_to: refund > 0 ? to : undefined, reason_code: code || undefined, reason_text: reasonText || undefined }); }
    finally { setBusy(false); }
  };

  return (
    <Modal isOpen onClose={onClose} title={title} size="md">
      <div className="space-y-4 text-sm">
        <p className="text-slate-700">{preview?.text || (refund > 0 ? `You'll be refunded ${rupee(refund)}.` : 'No refund applies.')}</p>
        {refund > 0 && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
            <p><b>{rupee(refund)} goes to your SKOVO Wallet instantly.</b></p>
            <p className="text-xs text-slate-600 mt-1">Use it for your next cohort, session or SKOVO Pro.</p>
          </div>
        )}
        <label className="block space-y-1">
          <span className="font-semibold text-slate-700">Why are you cancelling? (optional)</span>
          <select value={code} onChange={(e) => setCode(e.target.value)} className="w-full px-3 py-2 border rounded-xl bg-white">
            <option value="">Choose a reason</option>
            {REASONS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </label>
        {code === 'other' && <textarea value={reasonText} onChange={(e) => setReasonText(e.target.value)} rows={2} maxLength={500} className="w-full px-3 py-2 border rounded-xl" placeholder="Tell us more" />}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-xl border">Keep it</button>
          <button onClick={go} disabled={busy} className="px-4 py-2 rounded-xl bg-red-600 text-white font-semibold disabled:opacity-50">{busy ? 'Cancelling…' : confirmLabel}</button>
        </div>
      </div>
    </Modal>
  );
}
