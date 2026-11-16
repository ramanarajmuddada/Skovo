/**
 * The upload rules, in one place.
 *
 * Kept out of FilePicker.jsx so that file exports only a component — mixing
 * constants in breaks Fast Refresh, and the rules are wanted by callers that
 * validate before they ever render a picker.
 *
 * These mirror ALLOWED_EXTENSIONS and MAX_SIZE_BYTES in the upload route
 * (portal/routes/Upload/upload.py). The server is still the authority; if the
 * server list changes, change it here too. A client that allows more than the
 * server just moves the rejection later, to after the bytes have gone out.
 */
export const ALLOWED_EXT = ['pdf', 'jpg', 'jpeg', 'png', 'gif', 'webp', 'doc', 'docx'];
export const MAX_BYTES = 10 * 1024 * 1024;
export const ACCEPT_ATTR = ALLOWED_EXT.map(e => '.' + e).join(',');

// Avatars only. Deliberately not `image/*`: that lets an iPhone offer HEIC from
// the camera roll, which the server rejects — so the person picks what looks
// like an ordinary photo and gets an error after the whole file has uploaded.
export const IMAGE_EXT = ['jpg', 'jpeg', 'png', 'gif', 'webp'];
export const ACCEPT_IMAGE = IMAGE_EXT.map(e => '.' + e).join(',');

export const prettySize = b => {
  if (b < 1024) return b + ' B';
  if (b < 1024 * 1024) return (b / 1024).toFixed(0) + ' KB';
  return (b / (1024 * 1024)).toFixed(1) + ' MB';
};

export const extOf = name => (name.split('.').pop() || '').toLowerCase();

export const isImageName = name => /^(jpg|jpeg|png|gif|webp)$/.test(extOf(name));

/**
 * Why this exact file cannot be sent, or null when it can.
 * Phrased so the message names the fix, not just the rule.
 */
export function validateImageFile(file) {
  const base = validateFile(file);
  if (base) return base;
  if (!IMAGE_EXT.includes(extOf(file.name))) {
    return 'Choose an image — JPG, PNG, GIF or WEBP.';
  }
  return null;
}

export function validateFile(file) {
  if (!file) return 'Choose a file first.';

  const ext = extOf(file.name);

  if (!file.name.includes('.') || !ext) {
    return 'That file has no extension, so we cannot tell what type it is.';
  }
  // iPhones hand back HEIC from the camera roll. It looks like an ordinary
  // photo to the person picking it, and the server rejects it — worth saying
  // why, and what to do instead.
  if (ext === 'heic' || ext === 'heif') {
    return 'iPhone HEIC photos are not supported. Open the photo, tap Share, save it as JPEG, then upload that.';
  }
  if (!ALLOWED_EXT.includes(ext)) {
    return `.${ext} files are not accepted. Use a PDF, an image (JPG, PNG, GIF, WEBP) or a Word document.`;
  }
  if (file.size === 0) {
    return 'That file is empty. It may not have finished downloading or syncing yet.';
  }
  if (file.size > MAX_BYTES) {
    return `That file is ${prettySize(file.size)}. The limit is 10 MB — try compressing it, or photograph the document instead of scanning it.`;
  }
  return null;
}
