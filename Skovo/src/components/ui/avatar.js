/**
 * The one profile picture everybody starts with.
 *
 * Every avatar on the platform used to be a bare `<img src={url}>`. That has two
 * failure modes and both were live: a user who never uploaded anything rendered
 * an empty box, and a user whose file was deleted from the bucket rendered the
 * browser's broken-image icon with the alt text beside it.
 *
 * It is a data URI rather than a file in /public for the reason that matters
 * here: a default that is itself fetched over the network can 404 too, and then
 * there is nothing left to fall back to. This one is part of the bundle, needs
 * no request, and cannot fail.
 *
 * Drawn with `currentColor` on a neutral ground so it sits correctly on a card
 * in either theme, and cropped like a real portrait -- head and shoulders,
 * centred, filling the frame -- so a grid of mostly-default avatars reads as
 * deliberate rather than broken.
 */

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" width="96" height="96">
  <rect width="96" height="96" fill="#e8eaf0"/>
  <circle cx="48" cy="37" r="16" fill="#b6bccb"/>
  <path d="M16 96c0-17.7 14.3-32 32-32s32 14.3 32 32z" fill="#b6bccb"/>
</svg>`;

/** Inline, request-free, and impossible to 404. */
export const DEFAULT_AVATAR =
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(SVG.replace(/\n\s*/g, ''))}`;

/** The src to render: whatever the user has, otherwise the shared default. */
export function avatarSrc(...candidates) {
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return c;
  }
  return DEFAULT_AVATAR;
}

/**
 * onError for an avatar `<img>`.
 *
 * This writes to the DOM node, which React owns. It works until the next
 * re-render, when React reconciles `src` back to the broken URL from props --
 * and the fell-back marker then stops it being fixed a second time, so the
 * image stays broken for good. Any component that re-renders after an avatar
 * fails needs <AvatarImg>, which keeps the failure in state where a render
 * cannot undo it.
 *
 * Kept for the one call site that renders a plain `<img>` inside a list that
 * does not re-render on its own.
 */
export function onAvatarError(e) {
  const img = e.currentTarget;
  if (img.dataset.fellBack === '1') return;
  img.dataset.fellBack = '1';
  img.onerror = null;
  img.src = DEFAULT_AVATAR;
}

/** Everything an avatar `<img>` needs, so call sites cannot forget the fallback. */
export function avatarImgProps(...candidates) {
  return { src: avatarSrc(...candidates), onError: onAvatarError };
}
