// WCAG 2.1 relative luminance and contrast ratio, as a string injected into the
// page. Lifted verbatim out of 43-ui04-accessibility.spec.js so UI02-165 and
// UI04-015 compute contrast the same way rather than growing two definitions
// that can disagree about the same colour.
//
// The part that matters is _bgOf: alpha is composited against whatever is
// underneath rather than treated as solid. A 12%-alpha chip on a near-black
// sidebar measures 2.87:1 if you discard the alpha and comfortably passes if
// you do not, so a checker without compositing invents failures on every
// translucent surface in the app.
const CONTRAST_FN = `
  function _lum(c) {
    const v = c.map((x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
  }
  function _parse(s) {
    const m = (s || '').match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(',').map((x) => parseFloat(x));
    const a = p.length > 3 ? p[3] : 1;
    if (a === 0) return null;
    return [p[0], p[1], p[2], a];
  }
  function _bgOf(el) {
    const layers = [];
    let n = el;
    while (n && n !== document.documentElement) {
      const c = _parse(getComputedStyle(n).backgroundColor);
      if (c) {
        layers.push(c);
        if (c[3] >= 0.999) break;
      }
      n = n.parentElement;
    }
    if (!layers.length || layers[layers.length - 1][3] < 0.999) {
      layers.push([255, 255, 255, 1]);
    }
    let out = layers.pop().slice(0, 3);
    while (layers.length) {
      const [r, g, b, a] = layers.pop();
      out = [r * a + out[0] * (1 - a),
             g * a + out[1] * (1 - a),
             b * a + out[2] * (1 - a)];
    }
    return out;
  }
  function _ratio(a, b) {
    const l1 = _lum(a), l2 = _lum(b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  }
`;

module.exports = { CONTRAST_FN };
