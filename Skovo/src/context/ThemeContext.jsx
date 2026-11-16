import React, { createContext, useContext, useEffect, useState } from 'react';

export const THEMES = [
  { key: 'blue',    hex: '#2563eb', label: 'Blue'   },
  { key: 'violet',  hex: '#7c3aed', label: 'Violet' },
  { key: 'emerald', hex: '#059669', label: 'Green'  },
  { key: 'rose',    hex: '#e11d48', label: 'Rose'   },
  { key: 'orange',  hex: '#ea580c', label: 'Orange' },
  { key: 'teal',    hex: '#0d9488', label: 'Teal'   },
  { key: 'indigo',  hex: '#4338ca', label: 'Indigo' },
  { key: 'pink',    hex: '#db2777', label: 'Pink'   },
];

const ThemeCtx = createContext({
  mode: 'dark', accent: 'blue',
  toggleMode: () => {}, setMode: () => {}, setAccent: () => {},
});

function readMode() {
  const saved = localStorage.getItem('sk-mode');
  const mode = saved === 'light' || saved === 'dark' ? saved : 'dark';
  document.documentElement.classList.toggle('dark', mode === 'dark');
  return mode;
}

export function ThemeProvider({ children }) {
  const [mode,   setMode]   = useState(readMode);
  const [accent, setAccent] = useState(() => localStorage.getItem('sk-accent') || 'blue');

  useEffect(() => {
    document.documentElement.classList.toggle('dark', mode === 'dark');
    localStorage.setItem('sk-mode', mode);
  }, [mode]);

  useEffect(() => {
    const root = document.documentElement;
    THEMES.forEach(t => root.classList.remove(`th-${t.key}`));
    root.classList.add(`th-${accent}`);
    localStorage.setItem('sk-accent', accent);
  }, [accent]);

  return (
    <ThemeCtx.Provider value={{
      mode, accent, setAccent, setMode,
      toggleMode: () => setMode(m => m === 'light' ? 'dark' : 'light'),
    }}>
      {children}
    </ThemeCtx.Provider>
  );
}

export const useTheme = () => useContext(ThemeCtx);
