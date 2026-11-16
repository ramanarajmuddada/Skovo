import React from 'react';
import { useLocation } from 'react-router-dom';

/**
 * Re-runs the page entrance animation on every route change.
 *
 * The trick is the `key`: giving React a new key on navigation forces a fresh
 * mount of the subtree, which restarts the CSS animation. Without it the class
 * is already applied and the browser has nothing to re-trigger, so only the
 * very first page you land on would animate.
 *
 * CSS rather than an animation library on purpose — the keyframes are a few
 * lines in index.css, where framer-motion would be ~50KB gzipped for the same
 * effect on a product whose users are on mid-range Android over patchy
 * networks. Collapses automatically under prefers-reduced-motion.
 *
 * Uses `mo-page` (opacity) rather than `mo-in` (opacity + translate) on
 * purpose. Pages render their modals inside this wrapper, and an element with
 * a filling transform animation becomes the containing block for
 * position:fixed children — which broke every modal in the app. See the note
 * on `.mo-page` in index.css.
 */
export default function PageTransition({ children, className = '' }) {
  const { pathname } = useLocation();
  return (
    <div key={pathname} className={`mo-page ${className}`}>
      {children}
    </div>
  );
}
