import { useEffect } from 'react';

/**
 * Tables become cards on phones, across a whole portal.
 *
 * Wide tables only fitted a phone by scrolling sideways. Rather than rewrite
 * every table as a card list, this labels each cell with its column header
 * (data-label) and marks the table `data-cards`; index.css then shows each
 * row as a card of "label  value" lines below 768px. Desktop is untouched.
 *
 * Runs on everything inside #main-content and keeps up as rows load, so pages
 * need no changes. A table can opt out with `data-no-cards`.
 */
const SERIAL = /^(s\.?\s*no\.?|sr\.?\s*no\.?|#|no\.?)$/i;
const ACTIONS = /^actions?$/i;
const EMPTY = /^(—|–|-|n\/a)?$/i;

export default function useMobileCardTables() {
  useEffect(() => {
    const root = document.getElementById('main-content');
    if (!root) return undefined;

    const label = (table) => {
      if (table.hasAttribute('data-no-cards')) return;
      const heads = [...table.querySelectorAll('thead th')].map((th) => th.textContent.trim());
      if (!heads.length) return;
      // An attribute, not a class: React rewrites className on re-render and
      // would strip a class it did not set, turning the table back mid-page.
      if (!table.hasAttribute('data-cards')) table.setAttribute('data-cards', '');
      table.querySelectorAll('tbody tr').forEach((tr) => {
        let col = 0;
        let titled = false;
        [...tr.children].forEach((td) => {
          const span = Number(td.getAttribute('colspan') || 1);
          // A cell spanning several columns is a message row ("Loading…").
          const head = span > 1 ? '' : (heads[col] || '');
          let role = '';
          if (span === 1 && SERIAL.test(head)) role = 'sno';
          else if (span === 1 && (head === '' || ACTIONS.test(head))) role = 'actions';
          else if (!titled && span === 1) { role = 'title'; titled = true; }
          const text = role === 'actions' ? '' : head;
          if (td.getAttribute('data-label') !== text) td.setAttribute('data-label', text);
          if ((td.getAttribute('data-role') || '') !== role) {
            if (role) td.setAttribute('data-role', role); else td.removeAttribute('data-role');
          }
          // "—" / blank cells say nothing on a card; drop the line.
          const empty = !td.querySelector('button,a,img,svg,input,select')
            && EMPTY.test(td.textContent.trim());
          if (empty !== td.hasAttribute('data-empty')) td.toggleAttribute('data-empty', empty);
          col += span;
        });
      });
    };

    let queued = false;
    const run = () => {
      queued = false;
      root.querySelectorAll('table').forEach(label);
    };
    run();
    const obs = new MutationObserver(() => {
      if (!queued) { queued = true; requestAnimationFrame(run); }
    });
    obs.observe(root, { childList: true, subtree: true });
    return () => obs.disconnect();
  }, []);
}
