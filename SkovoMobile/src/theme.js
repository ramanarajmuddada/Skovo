// ── SKOVO mobile design system ───────────────────────────────────────────────
// One source of truth for colour, spacing, radius, type, shadow and motion, so
// the whole app moves together. Tweak here, the whole UI updates.
//
// Light and dark palettes share the same keys. Screens read them through
// `useTheme()` so a scheme change re-renders without renaming anything.
// `colors` stays the light palette for the few module-level reads (payments).

import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { StyleSheet, useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const PREF_KEY = '@skovo/appearance';
const ACCENT_KEY = '@skovo/accent';

// Same eight keys as the web ThemeDropdown. `onDark` is the readable
// member for pill text and captions sitting on a tinted well in dark mode
// (web's `--accent-ring`).
export const ACCENTS = [
  { key: 'blue',    hex: '#2563EB', dark: '#1D4ED8', onDark: '#93C5FD', label: 'Blue' },
  { key: 'violet',  hex: '#7C3AED', dark: '#6D28D9', onDark: '#DDD6FE', label: 'Violet' },
  { key: 'emerald', hex: '#059669', dark: '#047857', onDark: '#6EE7B7', label: 'Green' },
  { key: 'rose',    hex: '#E11D48', dark: '#BE123C', onDark: '#FDA4AF', label: 'Rose' },
  { key: 'orange',  hex: '#EA580C', dark: '#C2410C', onDark: '#FDBA74', label: 'Orange' },
  { key: 'teal',    hex: '#0D9488', dark: '#0F766E', onDark: '#5EEAD4', label: 'Teal' },
  { key: 'indigo',  hex: '#5B5BD6', dark: '#4642B8', onDark: '#C4C4F5', label: 'Indigo' },
  { key: 'pink',    hex: '#DB2777', dark: '#BE185D', onDark: '#F9A8D4', label: 'Pink' },
];

export const lightColors = {
  bg:         '#F6F7FC',
  surface:    '#FFFFFF',
  surfaceAlt: '#F1F3FA',
  surfaceSunk:'#EBEEF7',
  overlay:    'rgba(15,23,42,0.55)',

  text:       '#0B1220',
  textMuted:  '#4A5870',
  textSubtle: '#64748B',
  onPrimary:  '#FFFFFF',

  border:     '#E4E8F2',
  borderSoft: '#EFF2F9',

  primary:     '#5B5BD6',
  primaryDark: '#4642B8',
  primarySoft: '#EEEFFE',
  primaryTint: '#DDDEFB',

  achiever:     '#7C3AED',
  achieverDark: '#6D28D9',
  achieverSoft: '#F3EDFE',

  success:     '#0EA26B',
  successSoft: '#E4F7EF',
  warning:     '#E08700',
  warningSoft: '#FEF4E4',
  danger:      '#E23D3D',
  dangerSoft:  '#FDECEC',
  info:        '#0C93D4',
  infoSoft:    '#E4F5FD',
};

// Same keys as light. Surfaces match the web dark `--bg` (#020617); text and
// soft tints are lifted so captions clear WCAG on those panels.
export const darkColors = {
  bg:         '#020617',
  surface:    '#0F172A',
  surfaceAlt: '#1E293B',
  surfaceSunk:'#020617',
  overlay:    'rgba(2,6,23,0.72)',

  text:       '#F1F5F9',
  textMuted:  '#94A3B8',
  textSubtle: '#7B8BA3',
  onPrimary:  '#FFFFFF',

  border:     '#1E293B',
  borderSoft: '#162032',

  primary:     '#5B5BD6',
  primaryDark: '#C4C4F5',
  primarySoft: 'rgba(91,91,214,0.22)',
  primaryTint: 'rgba(91,91,214,0.32)',

  achiever:     '#A78BFA',
  achieverDark: '#DDD6FE',
  achieverSoft: 'rgba(124,58,237,0.22)',

  success:     '#34D399',
  successSoft: 'rgba(52,211,153,0.16)',
  warning:     '#FBBF24',
  warningSoft: 'rgba(251,191,36,0.16)',
  danger:      '#F87171',
  dangerSoft:  'rgba(248,113,113,0.16)',
  info:        '#38BDF8',
  infoSoft:    'rgba(56,189,248,0.16)',
};

/** Colour at an opacity — `tint(colors.primary, 0.12)`.
 *  Saves scattering `+ '18'` hex-alpha suffixes that nobody can read. */
export const tint = (hex, alpha = 0.12) => {
  if (!hex) return `rgba(91,91,214,${alpha})`;
  if (hex.startsWith('rgba')) {
    const parts = hex.slice(5, -1).split(',').map((x) => x.trim());
    return `rgba(${parts[0]}, ${parts[1]}, ${parts[2]}, ${alpha})`;
  }
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
};

const lightGradients = {
  student:  ['#6366F1', '#8B5CF6'],
  achiever: ['#7C3AED', '#9333EA'],
  success:  ['#10B981', '#059669'],
  primary:  ['#6366F1', '#5B5BD6'],
  danger:   ['#F05252', '#E23D3D'],
  dark:     ['#1E293B', '#0B1220'],
};

const darkGradients = {
  ...lightGradients,
  primary:  ['#818CF8', '#5B5BD6'],
};

export const spacing = (n) => n * 4;

export const radius = {
  xs: 8,
  sm: 12,
  md: 16,
  lg: 24,
  xl: 32,
  pill: 999,
};

export const font = {
  xs: 12, sm: 14, base: 16, md: 17, lg: 20, xl: 24, xxl: 30, huge: 36,
  regular: '400', medium: '500', semibold: '600', bold: '700', black: '800',
  tightest: -0.8, tight: -0.4, normal: 0, wide: 0.4, widest: 0.8,
};

const lightShadow = {
  none: {},
  soft: {
    shadowColor: '#0B1220',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 1,
  },
  card: {
    shadowColor: '#0B1220',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.05,
    shadowRadius: 20,
    elevation: 2,
  },
  lifted: {
    shadowColor: '#0B1220',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.08,
    shadowRadius: 28,
    elevation: 6,
  },
  floating: {
    shadowColor: '#5B5BD6',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.28,
    shadowRadius: 20,
    elevation: 8,
  },
};

const darkShadow = {
  none: {},
  soft: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 1,
  },
  card: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.45,
    shadowRadius: 16,
    elevation: 3,
  },
  lifted: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.55,
    shadowRadius: 24,
    elevation: 6,
  },
  floating: {
    shadowColor: '#5B5BD6',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.4,
    shadowRadius: 20,
    elevation: 8,
  },
};

export const motion = {
  fast: 140,
  base: 200,
  slow: 320,
  press: 0.97,
  stagger: 45,
  staggerCap: 8,
};

export const tap = 44;

// Light aliases so existing module-level reads (`payments`, a few constants)
// keep compiling. Screens must use `useTheme()` so they follow dark mode.
export const colors = lightColors;
export const gradients = lightGradients;
export const shadow = lightShadow;

function accentOf(key) {
  return ACCENTS.find((t) => t.key === key) || ACCENTS.find((t) => t.key === 'indigo');
}

function paintAccent(base, accentKey, isDark) {
  const a = accentOf(accentKey);
  return {
    ...base,
    primary:     a.hex,
    primaryDark: isDark ? a.onDark : a.dark,
    primarySoft: isDark ? tint(a.hex, 0.22) : tint(a.hex, 0.12),
    primaryTint: isDark ? tint(a.hex, 0.32) : tint(a.hex, 0.22),
  };
}

function gradientsFor(accentKey, isDark) {
  const a = accentOf(accentKey);
  const ramp = [a.hex, a.dark];
  return {
    ...(isDark ? darkGradients : lightGradients),
    student: ramp,
    primary: isDark ? [a.onDark, a.hex] : ramp,
  };
}

function shadowFor(accentKey, isDark) {
  const a = accentOf(accentKey);
  const base = isDark ? darkShadow : lightShadow;
  return {
    ...base,
    floating: { ...base.floating, shadowColor: a.hex },
  };
}

const ThemeCtx = createContext(null);

export function ThemeProvider({ children }) {
  const system = useColorScheme();
  const [preference, setPrefState] = useState('system');
  const [accent, setAccentState] = useState('indigo');

  useEffect(() => {
    AsyncStorage.multiGet([PREF_KEY, ACCENT_KEY])
      .then((pairs) => {
        const map = Object.fromEntries(pairs);
        const pref = map[PREF_KEY];
        const acc = map[ACCENT_KEY];
        if (pref === 'light' || pref === 'dark' || pref === 'system') setPrefState(pref);
        if (acc && ACCENTS.some((t) => t.key === acc)) setAccentState(acc);
      })
      .catch(() => {});
  }, []);

  const setPreference = (next) => {
    setPrefState(next);
    AsyncStorage.setItem(PREF_KEY, next).catch(() => {});
  };

  const setAccent = (next) => {
    setAccentState(next);
    AsyncStorage.setItem(ACCENT_KEY, next).catch(() => {});
  };

  const scheme = preference === 'system'
    ? (system === 'dark' ? 'dark' : 'light')
    : preference;
  const isDark = scheme === 'dark';

  const value = useMemo(() => ({
    scheme,
    preference,
    setPreference,
    accent,
    setAccent,
    accentMeta: accentOf(accent),
    isDark,
    colors: paintAccent(isDark ? darkColors : lightColors, accent, isDark),
    shadow: shadowFor(accent, isDark),
    gradients: gradientsFor(accent, isDark),
  }), [scheme, preference, isDark, accent]);

  return <ThemeCtx.Provider value={value}>{children}</ThemeCtx.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeCtx);
  if (!ctx) {
    return {
      scheme: 'light',
      preference: 'system',
      setPreference: () => {},
      accent: 'indigo',
      setAccent: () => {},
      accentMeta: accentOf('indigo'),
      isDark: false,
      colors: lightColors,
      shadow: lightShadow,
      gradients: lightGradients,
    };
  }
  return ctx;
}

/** Rebuild a StyleSheet when the palette changes. `factory` should be a
 *  module-level function `(colors, shadow) => ({ ... })`. */
export function useThemedStyles(factory) {
  const { colors: c, shadow: sh, scheme, accent } = useTheme();
  return useMemo(
    () => StyleSheet.create(factory(c, sh)),
    [c, sh, scheme, accent, factory],
  );
}

export default {
  colors, tint, gradients, spacing, radius, font, shadow, motion, tap,
  lightColors, darkColors, ACCENTS, useTheme, useThemedStyles, ThemeProvider,
};
