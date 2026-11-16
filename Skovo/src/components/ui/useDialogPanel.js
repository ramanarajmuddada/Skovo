import { useEffect, useId, useRef } from 'react';

/**
 * Turn a hand-rolled `fixed inset-0` overlay into a real dialog.
 *
 * Most overlays in this app are written inline rather than through `ui.Modal` —
 * the task detail view, the document form, the achiever roster and so on. They
 * look right and they are operable with a mouse, but to assistive technology
 * they were anonymous `div`s: nothing announced that a dialog had opened,
 * nothing said what it was for, and the page behind stayed presented as
 * readable. Keyboard users had it worse — Tab walked straight out of the
 * overlay onto controls hidden under the backdrop, which are invisible but
 * still respond to Enter.
 *
 * Rather than rewrite every screen onto `Modal`, this supplies the same
 * behaviour as props:
 *
 *   const dialog = useDialogPanel({ onClose, label: 'Add document' });
 *   <div className="fixed inset-0 …">
 *     <div {...dialog.panelProps}> … </div>
 *   </div>
 *
 * Spread `titleProps` on the heading instead of passing `label` when the dialog
 * already renders its own title — pointing at the visible heading is better
 * than duplicating its words in an attribute that can drift from it.
 */
export function useDialogPanel({ onClose, label, open = true } = {}) {
  const panelRef = useRef(null);
  const returnTo = useRef(null);
  const titleId = useId();

  // Escape closes; Tab cycles inside. The trap is what makes `aria-modal` true
  // rather than merely claimed.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') { onClose?.(); return; }
      if (e.key !== 'Tab') return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusable = [...panel.querySelectorAll(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]),'
        + ' textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]
        .filter((el) => el.getClientRects().length);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !panel.contains(active))) {
        e.preventDefault(); last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault(); first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Move focus in, and put it back on close. Restoring matters as much as
  // moving: a dialog opened from a row in a long table and closed without it
  // drops focus to the top of the document, so the next Tab starts the page
  // again from the sidebar.
  useEffect(() => {
    if (!open) return undefined;
    returnTo.current = document.activeElement;
    const id = window.requestAnimationFrame(() => {
      const panel = panelRef.current;
      if (!panel) return;
      const target = panel.querySelector(
        'input:not([type="hidden"]):not([disabled]), textarea:not([disabled]),'
        + ' select:not([disabled]), button:not([disabled]), a[href]');
      (target || panel).focus({ preventScroll: true });
    });
    return () => {
      window.cancelAnimationFrame(id);
      const back = returnTo.current;
      if (back && typeof back.focus === 'function' && document.contains(back)) {
        back.focus({ preventScroll: true });
      }
    };
  }, [open]);

  return {
    titleId,
    panelRef,
    panelProps: {
      ref: panelRef,
      role: 'dialog',
      'aria-modal': 'true',
      ...(label ? { 'aria-label': label } : { 'aria-labelledby': titleId }),
      tabIndex: -1,
    },
    titleProps: { id: titleId },
  };
}

export default useDialogPanel;
