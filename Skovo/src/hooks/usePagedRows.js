import { useMemo, useState } from 'react';

/**
 * Client-side pagination for list screens whose endpoint returns everything.
 *
 * Several admin endpoints (coupons, courses, branches, abroad programmes…) call
 * their stored procedure with a fixed high limit and hand back the whole array,
 * so there is no page/offset to pass through. This slices locally and gives the
 * shared <Pagination> exactly the props it expects.
 *
 *   const p = usePagedRows(coupons);
 *   …
 *   {p.rows.map(…)}
 *   <Pagination {...p.bind} />
 *
 * 20 per page matches every server-paginated screen in the app, so the two
 * kinds of list behave identically to the person using them.
 */
export function usePagedRows(rows, initialPerPage = 20) {
  const all = useMemo(() => rows || [], [rows]);
  const [requestedPage, setPage] = useState(1);
  const [perPage, setPerPage] = useState(initialPerPage);

  const total = all.length;
  const pages = Math.max(1, Math.ceil(total / perPage));

  // Clamp during render rather than correcting in an effect. Deleting the last
  // row on the final page, or filtering the list down, would otherwise strand
  // the user on an empty page; an effect would fix it a frame later, after
  // rendering the empty state once.
  const page = Math.min(requestedPage, pages);

  const start = (page - 1) * perPage;
  const visible = useMemo(() => all.slice(start, start + perPage), [all, start, perPage]);

  return {
    rows: visible,
    page,
    pages,
    total,
    perPage,
    setPage,
    reset: () => setPage(1),
    bind: {
      page, pages, total, perPage,
      onPage: setPage,
      onPerPage: (n) => { setPerPage(n); setPage(1); },
    },
  };
}

export default usePagedRows;
