import React from 'react';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';
import HelpSupportPage from '../components/support/HelpSupportPage';

export default function HelpSupport() {
  const { user } = useAuth();
  return <HelpSupportPage api={api} userEmail={user?.email} source="web" />;
}
