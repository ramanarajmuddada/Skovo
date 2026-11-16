// ── Auth state — the signed-in student ───────────────────────────────────────
//
// STUDENT ONLY. The mobile app used to carry an achiever portal alongside this
// one; it was removed because it only ever had 7 of the web's 11 screens and had
// no verification, cohort management or earnings behind them. An achiever
// signing in is now told where their portal is (LoginScreen) rather than being
// dropped into a partial app.
import React, { createContext, useContext, useEffect, useState } from 'react';
import { clearWidget } from '../services/widget';
import { auth, studentApi, setSessionExpiredHandler } from '../services/api';
import { registerForPush } from '../services/push';

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }) {
  const [booting, setBooting] = useState(true);
  const [portal, setPortal]   = useState(null);   // 'student' | null
  const [user, setUser]       = useState(null);

  // Restore a session on launch.
  useEffect(() => {
    (async () => {
      const s = await auth.getStudent();
      if (s) { setPortal('student'); setUser(s.user); setBooting(false); return; }

      // An achiever token can still be sitting in storage from a build that had
      // the achiever portal. There is no navigator to mount it now, so leaving
      // it would strand the app on a blank stack with no way back to Landing.
      // Clear it once, on launch, and fall through to signed-out.
      await auth.clearAchiever();
      setBooting(false);
    })();
  }, []);

  const loginStudent = async (token, u, refresh) => {
    await auth.saveStudent(token, u, refresh);
    setUser(u); setPortal('student');
    registerForPush(studentApi);   // best-effort, never blocks
  };

  useEffect(() => {
    setSessionExpiredHandler(() => { setUser(null); setPortal(null); });
    return () => setSessionExpiredHandler(null);
  }, []);

  const logout = async () => {
    await auth.clearStudent();
    clearWidget();
    setUser(null); setPortal(null);
  };

  return (
    <AuthContext.Provider value={{ booting, portal, user, loginStudent, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
