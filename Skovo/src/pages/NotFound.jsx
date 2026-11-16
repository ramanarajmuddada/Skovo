import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Home, AlertCircle } from 'lucide-react';
import { Button } from '../components/ui/index.jsx';

export default function NotFound() {
  const navigate = useNavigate();
  const location = useLocation();
  const pathName = location.pathname.substring(1) || 'home';

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
      <div className="flex flex-col items-center text-center max-w-sm w-full">
        <div className="w-20 h-20 rounded-3xl bg-slate-100 flex items-center justify-center mb-6">
          <AlertCircle size={36} className="text-slate-400" />
        </div>
        <h1 className="text-7xl font-black text-slate-200 tracking-tight mb-4">404</h1>
        <h2 className="text-xl font-bold text-slate-900 mb-2">Page not found</h2>
        <p className="text-slate-500 text-sm mb-8">
          <span className="font-semibold text-slate-700">/{pathName}</span> doesn't exist or was moved.
        </p>
        <Button variant="primary" size="lg" onClick={() => navigate('/')}>
          <Home size={16} /> Go Home
        </Button>
      </div>
    </div>
  );
}
