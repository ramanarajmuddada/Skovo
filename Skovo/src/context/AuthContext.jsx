import React, { createContext, useContext, useState } from 'react';
import { api, saveTokens, clearTokens } from '../services/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    try {
      const stored = localStorage.getItem('user');
      if (!stored) return null;
      const parsed = JSON.parse(stored);
      // Backfill `id` for sessions saved before the user_id→id normalization.
      if (parsed && parsed.id == null && parsed.user_id != null) parsed.id = parsed.user_id;
      return parsed;
    } catch {
      return null;
    }
  });

  const _applyAuth = (data) => {
    saveTokens(data.access_token, data.refresh_token);
    // Backend returns the id field as `user_id`; expose it as `id` for the app.
    const userData = { ...data.response, id: data.response.user_id ?? data.response.id };
    localStorage.setItem('user', JSON.stringify(userData));
    setUser(userData);
    return data;
  };

  // `purpose` defaults to signup, which is what every caller but the reset
  // screen means. Reset has to say so: the server runs the SIGNUP conflict
  // guard otherwise and refuses every address that already has an account --
  // i.e. exactly the people trying to reset a password.
  const sendOtp = async ({ phone, email, purpose, role }) => {
    const { data } = await api.post('/auth/otp/send', { phone, email, purpose, role });
    if (!data.bool) throw new Error(data.response?.message || 'Failed to send OTP');
    // No dev_otp. The server stopped returning the OTP on 2026-09-06 — its
    // guard defaulted to DEV, so it failed open and the code was readable
    // out of the JSON by anyone who could post an email address.
    return data;
  };

  const verifyOtp = async ({ phone, email, otp, full_name, role, institution_name, institution_subdomain, password, referral_code }) => {
    const payload = { otp };
    if (phone) payload.phone = phone;
    if (email) payload.email = email;
    if (full_name) payload.full_name = full_name;
    if (role) payload.role = role;
    if (institution_name) payload.institution_name = institution_name;
    if (institution_subdomain) payload.institution_subdomain = institution_subdomain;
    if (password) payload.password = password;
    if (referral_code) payload.referral_code = referral_code;
    const { data } = await api.post('/auth/otp/verify', payload);
    if (!data.bool) throw new Error(data.response?.message || 'OTP verification failed');
    return _applyAuth(data);
  };

  const registerWithPassword = async ({ full_name, email, password, referral_code }) => {
    const { data } = await api.post('/auth/register', { full_name, email, password, referral_code });
    if (!data.bool) throw new Error(data.response?.message || 'Registration failed');
    return _applyAuth(data);
  };

  // Step 1 of sign-in. The server checks the password and emails a code; it does
  // NOT return a session. The caller gets { otpRequired: true, ... } and must
  // finish with verifyLoginOtp(). (If the server has the second step switched
  // off it returns the session directly, and that is applied as before.)
  const loginWithPassword = async ({ email, password }) => {
    const { data } = await api.post('/auth/login', { email, password });
    if (!data.bool) throw new Error(data.response?.message || 'Login failed');
    if (data.response?.otp_required) {
      const r = data.response;
      return { otpRequired: true, challengeId: r.challenge_id, emailMasked: r.email_masked, resendIn: r.resend_in };
    }
    return _applyAuth(data);
  };

  // Step 2: the emailed code. Only a correct, unexpired, unused code returns tokens.
  const verifyLoginOtp = async ({ challengeId, otp }) => {
    const { data } = await api.post('/auth/login/verify', { challenge_id: challengeId, otp });
    if (!data.bool) throw new Error(data.response?.message || 'Verification failed');
    return _applyAuth(data);
  };

  const resendLoginOtp = async ({ challengeId }) => {
    const { data } = await api.post('/auth/login/resend', { challenge_id: challengeId });
    if (!data.bool) {
      const err = new Error(data.response?.message || 'Could not resend the code.');
      err.retryAfter = data.response?.retry_after;
      throw err;
    }
    return data.response;
  };

  const adminLogin = async ({ email, password }) => {
    const { data } = await api.post('/skovo-platform-panel-admin/login', { email, password });
    if (!data.bool) throw new Error(data.response?.message || 'Invalid credentials.');
    const userData = { ...data.response, access_token: data.access_token };
    localStorage.setItem('admin_user', JSON.stringify(userData));
    localStorage.setItem('admin_access_token', data.access_token);
    return data;
  };

  const adminSendOtp = async ({ email }) => {
    const { data } = await api.post('/skovo-platform-panel-admin/send-otp', { email });
    if (!data.bool) throw new Error(data.response?.message || 'Failed to send OTP.');
    return data;
  };

  const adminRegister = async ({ full_name, email, password, otp }) => {
    const { data } = await api.post('/skovo-platform-panel-admin/register', { full_name, email, password, otp });
    if (!data.bool) throw new Error(data.response?.message || 'Registration failed.');
    return data;
  };

  const logout = async () => {
    try {
      await api.post('/auth/logout', {});
    } catch {}
    clearTokens();
    setUser(null);
  };

  // Merges into the *current* user, not the one captured when the caller was
  // created. MainLayout fires two independent mount effects (/profile/ and
  // /auth/me) that each call this from a closure over the first render's user;
  // spreading that stale copy meant whichever response landed second silently
  // dropped what the first had written.
  const updateUser = (updates) => {
    setUser(prev => {
      // A background sync that finds nothing changed must not re-render the
      // whole app or rewrite the session for it.
      if (prev && Object.keys(updates).every(k => prev[k] === updates[k])) return prev;
      const updated = { ...prev, ...updates };
      localStorage.setItem('user', JSON.stringify(updated));
      return updated;
    });
  };

  return (
    <AuthContext.Provider value={{ user, sendOtp, verifyOtp, registerWithPassword, loginWithPassword, verifyLoginOtp, resendLoginOtp, adminLogin, adminSendOtp, adminRegister, logout, updateUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
