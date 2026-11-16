import React, { useState } from 'react';
import { DEFAULT_AVATAR } from './avatar';
import { mediaUrl } from '../../services/api';

/**
 * An avatar image that survives a re-render after the file has gone.
 *
 * The first version handled this with an onError that assigned `img.src`
 * directly. That works exactly once: React owns the `src` attribute, so the
 * next render reconciles it back to the broken URL from props, and the
 * "already fell back" marker then refuses to fix it a second time. The result
 * was a permanently broken image on any screen that re-renders after load --
 * which is most of them, since they fetch.
 *
 * Keeping the failure in state instead means a render cannot undo it: `src` is
 * derived from state, so React puts back the fallback rather than the 404.
 *
 * It remembers which src failed rather than that one did, so a genuinely new
 * photo retries by itself and a replacement upload shows immediately.
 *
 * `src` goes through mediaUrl() first. Uploaded files are stored as
 * "/uploads/<name>", which a browser resolves against the SPA origin rather
 * than the API -- that is what made a successfully uploaded achiever photo
 * render as the default avatar. Resolving here rather than at each call site
 * fixes every avatar in all four portals, including rows already written with
 * a relative path.
 */
export default function AvatarImg({ src, alt = '', className = '', ...rest }) {
  // Which src failed, not whether one did. A new photo is automatically a
  // different string, so it retries on its own -- no effect needed to clear a
  // flag, and no window where a fresh upload still shows the default.
  const [failedSrc, setFailedSrc] = useState(null);

  // Compared against the resolved URL, since that is what the browser tried.
  const url = mediaUrl(src);
  const usable = Boolean(url) && url !== failedSrc;
  const resolved = usable ? url : DEFAULT_AVATAR;

  return (
    <img
      {...rest}
      src={resolved}
      alt={alt}
      className={className}
      // The default is a data URI and cannot itself 404, so this cannot loop.
      onError={() => setFailedSrc(url)}
    />
  );
}
