import React, { useEffect, useState } from 'react';
import { Tabs } from '../admin/v1/AdminV1Kit';
import { useNavigate } from 'react-router-dom';
import { Sparkles, GraduationCap, Bookmark, Target } from 'lucide-react';
import { api } from '../../services/api';

// One filter strip shared by every college screen. Saved Colleges and the
// College Predictor used to be top-level sidebar entries; they are sub-views of
// Colleges, so they live here instead — a student looking for either one starts
// on Colleges, not by hunting the sidebar.
//
// The strip is route-driven rather than local state so /colleges/saved and
// /colleges/predictor stay linkable and the browser's back button still works.
//
// Only the Colleges page learns whether the student has a personalised list —
// it comes back with the college list, and Saved / Predictor never fetch it.
// They used to fall back to `personalised = false`, which collapsed the strip
// to a single "All Colleges" tab: opening Saved Colleges made the Browse All
// button vanish mid-session. So the flag is remembered per session instead.
// `personalised` left undefined means "this screen does not know" — use what
// Colleges last reported — and passing it explicitly records the new truth, so
// a student who drops their course preference stops seeing the split.
const REMEMBERED_KEY = 'skovo:colleges:personalised';

// sessionStorage throws outright in some privacy modes, so every touch is
// guarded — an unreadable flag must never crash the page.
//
// Reads are tri-state: null when nothing has been remembered yet. "This session
// has not been through Colleges" and "this student has no For You list" are
// different answers, and only the first is worth asking the server about.
const readRemembered = () => {
  try {
    const raw = sessionStorage.getItem(REMEMBERED_KEY);
    return raw === null ? null : raw === '1';
  } catch { return null; }
};
const remember = (value) => {
  try { sessionStorage.setItem(REMEMBERED_KEY, value ? '1' : '0'); } catch { /* ignore */ }
};

export default function CollegeTabs({ active, personalised, onBrowseMode }) {
  const navigate = useNavigate();

  const known = personalised !== undefined;
  useEffect(() => { if (known) remember(personalised); }, [known, personalised]);

  // Nothing remembered and nobody to tell us — a bookmarked /colleges/predictor
  // opened in a fresh tab, which never passes through Colleges on the way. Ask
  // the server for the flag directly rather than dropping Browse All from a
  // strip the student is entitled to. One row, purely for the student_context
  // riding along with it, and api.getCached collapses the repeat when they move
  // between Saved Colleges and the Predictor.
  const [probed, setProbed] = useState(null);
  useEffect(() => {
    if (known || readRemembered() !== null) return;
    let on = true;
    api.getCached('/colleges/', { page: 1, per_page: 1 }, { ttl: 60000 })
      .then(({ data }) => {
        const mode = data?.bool ? data.response?.student_context?.mode : null;
        if (!mode) return;
        remember(mode !== 'all');
        if (on) setProbed(mode !== 'all');
      })
      .catch(() => {});     // a blip leaves the strip as it is, never flips it
    return () => { on = false; };
  }, [known]);

  const showSplit = known ? !!personalised : (readRemembered() ?? probed ?? false);

  const go = (showAll) => {
    if (onBrowseMode) onBrowseMode(showAll);
    else navigate(showAll ? '/colleges?all=1' : '/colleges');
  };

  // The Colleges page asks for 'for-you' before its fetch has told it whether a
  // personalised list exists. When it does not, that tab is not rendered at
  // all, so fold the request onto the tab that is — otherwise the strip briefly
  // highlights nothing.
  const activeId = active === 'for-you' && !showSplit ? 'all' : active;

  const tabs = [
    ...(showSplit
      ? [{ id: 'for-you', label: 'For You',      icon: Sparkles,      onClick: () => go(false) },
         { id: 'all',     label: 'Browse All',   icon: GraduationCap, onClick: () => go(true)  }]
      : [{ id: 'all',     label: 'All Colleges', icon: GraduationCap, onClick: () => go(false) }]),
    { id: 'saved',     label: 'Saved Colleges',   icon: Bookmark, onClick: () => navigate('/colleges/saved') },
    { id: 'predictor', label: 'College Predictor', icon: Target,  onClick: () => navigate('/colleges/predictor') },
  ];

  // The platform's icon tabs (2x2 on a phone, one row from sm).
  return (
    <Tabs active={activeId}
          onChange={(k) => tabs.find((t) => t.id === k)?.onClick()}
          tabs={tabs.map(({ id, label, icon }) => ({ key: id, label: label.replace(' Colleges', '').replace('College ', ''), icon }))} />
  );
}
