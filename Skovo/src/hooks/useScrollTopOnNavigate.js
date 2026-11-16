import { useLayoutEffect } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * Put a scrolling pane back to the top whenever the route changes.
 *
 * The portals do not scroll the window. The shell is `h-screen overflow-hidden`
 * and the scrolling element is the `<main>` inside it, so neither the browser's
 * own scroll restoration nor React Router's `ScrollRestoration` — both of which
 * act on the window — has anything to reset. Nothing else did either, so
 * `main.scrollTop` simply survived every navigation.
 *
 * That is invisible going from one long page to another, and obvious the moment
 * a short page follows a long one: leave the colleges list scrolled halfway,
 * open College Predictor, and its form is a few hundred pixels above the
 * viewport with blank page below it. It reads as the page "opening in the
 * middle", but nothing scrolled — the pane never went back up.
 *
 * `PageTransition` does not cover this. Its `key={pathname}` remounts the
 * *children* of `<main>`; `<main>` itself is stable across navigation, and its
 * scroll offset with it.
 *
 * useLayoutEffect, not useEffect: this runs before the browser paints, so the
 * new page is never shown at the old offset first. With useEffect the reset
 * lands a frame late and reads as a jump.
 *
 * Keyed on pathname alone, deliberately. Screens that hold filters, tabs or
 * pagination in the query string are still the same page, and yanking the
 * reader to the top when they page a table would be a worse bug than the one
 * this fixes.
 *
 * @param {React.RefObject<HTMLElement>} ref - the scrolling element.
 */
export default function useScrollTopOnNavigate(ref) {
  const { pathname } = useLocation();

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Not scrollTo({ behavior: 'smooth' }): a page that animates its way to the
    // top on arrival looks like a glitch, and under a `scroll-behavior: smooth`
    // stylesheet even the plain call inherits it. Assigning scrollTop is exempt.
    el.scrollTop = 0;
  }, [pathname, ref]);
}
