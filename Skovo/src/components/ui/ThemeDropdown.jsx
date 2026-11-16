import React, { useState, useRef, useEffect } from 'react';
import { useTheme, THEMES } from '../../context/ThemeContext';
import { Check, Sun, Moon, Palette, X } from 'lucide-react';

export default function ThemeDropdown({ dark = false }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const { mode, setMode, accent, setAccent } = useTheme();
  const current = THEMES.find(t => t.key === accent);

  useEffect(() => {
    function handle(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, []);

  return (
    <div className="relative" ref={ref}>
      {/* Trigger */}
      <button
        onClick={() => setOpen(o => !o)}
        title="Theme settings"
        className={`flex items-center gap-2 px-3 py-2 min-h-11 rounded-xl border text-xs font-semibold transition-all ${
          dark
            ? 'border-white/15 bg-white/8 text-slate-300 hover:bg-white/14 hover:border-white/25'
            : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:border-slate-300'
        }`}
      >
        {/* Accent dot */}
        <span
          className="w-3.5 h-3.5 rounded-full shrink-0 ring-2 ring-offset-1"
          style={{
            backgroundColor: current?.hex,
            ringColor: current?.hex,
            ringOffsetColor: dark ? 'var(--sidebar-bg)' : 'white',
          }}
        />
        {mode === 'light' ? <Sun size={13} /> : <Moon size={13} />}
        <span className="hidden sm:inline">{current?.label}</span>
      </button>

      {/* Panel */}
      {open && (
        <>
          {/* Mobile backdrop */}
          <div
            className="fixed inset-0 z-40 sm:hidden"
            onClick={() => setOpen(false)}
          />

          {/* Panel follows the theme: dark in dark mode, light in light mode.
              It used to be inverted, so a bright white box opened on a dark
              screen. On phones it is pinned inside the screen; anchored to the
              button it hung off the left edge. */}
          <div
            className="fixed left-4 right-4 top-16 sm:absolute sm:left-auto sm:right-0 sm:top-full sm:mt-2 sm:w-[280px] z-50 rounded-2xl shadow-2xl overflow-hidden"
            style={{
              backgroundColor: mode === 'dark' ? '#1e293b' : '#ffffff',
              border: mode === 'dark' ? '1px solid rgba(51,65,85,0.8)' : '1px solid #e2e8f0',
              boxShadow: mode === 'dark'
                ? '0 20px 60px rgba(0,0,0,0.6)'
                : '0 20px 60px rgba(0,0,0,0.12)',
            }}
          >
            {/* Header */}
            <div
              className="flex items-center justify-between px-5 py-4"
              style={{
                borderBottom: mode === 'dark' ? '1px solid rgba(51,65,85,0.8)' : '1px solid #f1f5f9',
                background: mode === 'dark'
                  ? 'linear-gradient(135deg, #0f172a, #1e293b)'
                  : 'linear-gradient(135deg, #f8fafc, #fff)',
              }}
            >
              <div className="flex items-center gap-2.5">
                <div
                  className="w-8 h-8 rounded-xl flex items-center justify-center"
                  style={{ backgroundColor: 'var(--accent)' }}
                >
                  <Palette size={14} className="text-white" />
                </div>
                <div>
                  <p style={{ fontSize: 12, fontWeight: 700, color: mode === 'dark' ? '#f1f5f9' : '#1e293b' }}>
                    Appearance
                  </p>
                  <p style={{ fontSize: 11, color: mode === 'dark' ? '#64748b' : '#94a3b8' }}>
                    {current?.label} · {mode === 'dark' ? 'Dark' : 'Light'}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setOpen(false)}
                style={{
                  padding: 6, borderRadius: 8, border: 'none', cursor: 'pointer',
                  backgroundColor: 'transparent',
                  color: mode === 'dark' ? '#64748b' : '#94a3b8',
                }}
                onMouseEnter={e => e.currentTarget.style.backgroundColor = mode === 'dark' ? 'rgba(255,255,255,0.08)' : '#f1f5f9'}
                onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
              >
                <X size={14} />
              </button>
            </div>

            <div className="p-5 space-y-5">
              {/* ── Mode ── */}
              <div>
                <p style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 12, color: mode === 'dark' ? '#475569' : '#94a3b8' }}>
                  Mode
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { value: 'light', icon: Sun,  label: 'Light mode' },
                    { value: 'dark',  icon: Moon, label: 'Dark mode'  },
                  ].map(({ value, icon: Icon, label }) => {
                    const active = mode === value;
                    return (
                      <button
                        key={value}
                        onClick={() => setMode(value)}
                        className="flex flex-col items-center gap-2 py-3 px-2 rounded-xl text-xs font-semibold transition-all"
                        style={
                          active
                            ? { backgroundColor: 'var(--accent)', color: '#fff', boxShadow: '0 4px 14px var(--accent-ring)' }
                            : {
                                backgroundColor: mode === 'dark' ? 'rgba(255,255,255,0.05)' : '#f8fafc',
                                color: mode === 'dark' ? '#64748b' : '#94a3b8',
                                border: mode === 'dark' ? '1px solid rgba(51,65,85,0.8)' : '1px solid #e2e8f0',
                              }
                        }
                      >
                        <Icon size={18} />
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* ── Accent Color ── */}
              <div>
                <p style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 12, color: mode === 'dark' ? '#475569' : '#94a3b8' }}>
                  Accent Color
                </p>
                <div className="grid grid-cols-4 gap-2">
                  {THEMES.map(t => {
                    const active = accent === t.key;
                    return (
                      <button
                        key={t.key}
                        onClick={() => setAccent(t.key)}
                        title={t.label}
                        className="flex flex-col items-center gap-1.5 group"
                      >
                        <span
                          className="w-12 h-12 rounded-2xl flex items-center justify-center transition-all duration-200"
                          style={{
                            backgroundColor: t.hex,
                            transform: active ? 'scale(1.08)' : 'scale(1)',
                            boxShadow: active
                              ? `0 0 0 3px ${mode === 'dark' ? '#1e293b' : 'white'}, 0 0 0 5px ${t.hex}, 0 4px 14px ${t.hex}55`
                              : `0 2px 8px ${t.hex}33`,
                          }}
                        >
                          {active && <Check size={18} className="text-white" strokeWidth={2.5} />}
                        </span>
                        <span
                          style={{ fontSize: 10, fontWeight: 600, color: active ? t.hex : mode === 'dark' ? '#475569' : '#94a3b8' }}
                        >
                          {t.label}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
