import React from 'react';
import { achieverApi } from '../../services/api';
import HelpSupportPage from '../../components/support/HelpSupportPage';

export default function AchieverHelpSupport() {
  let email = '';
  try {
    email = JSON.parse(localStorage.getItem('achiever_user') || '{}').email || '';
  } catch { /* ignore */ }
  return <HelpSupportPage api={achieverApi} userEmail={email} source="web" audience="achiever" />;
}
