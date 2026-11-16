import React from 'react';
import { MapPin, Trophy, TrendingUp, IndianRupee } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Card, Badge, Button } from '../ui/index.jsx';

export default function CollegeCard({ college }) {
  const navigate = useNavigate();
  const typeColor = { government: 'emerald', private: 'blue', deemed: 'purple', autonomous: 'amber' }[college.type] || 'slate';

  return (
    <Card hover className="p-5 flex flex-col gap-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <h3 className="font-bold text-slate-900 text-sm leading-snug">{college.name}</h3>
          <div className="flex items-center gap-1 mt-1 text-xs text-slate-500">
            <MapPin size={11} /> {college.location_city}, {college.location_state}
          </div>
        </div>
        <Badge color={typeColor} size="xs">{college.type}</Badge>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {college.nirf_ranking && (
          <div className="bg-slate-50 rounded-xl p-2.5 text-center border border-slate-100">
            <p className="text-xs text-slate-500 flex items-center justify-center gap-1"><Trophy size={10} /> NIRF</p>
            <p className="font-bold text-slate-900 text-sm mt-0.5">#{college.nirf_ranking}</p>
          </div>
        )}
        {college.placement_rate && (
          <div className="bg-slate-50 rounded-xl p-2.5 text-center border border-slate-100">
            <p className="text-xs text-slate-500 flex items-center justify-center gap-1"><TrendingUp size={10} /> Placed</p>
            <p className="font-bold text-slate-900 text-sm mt-0.5">{college.placement_rate}%</p>
          </div>
        )}
        {college.annual_fees_min && (
          <div className="bg-slate-50 rounded-xl p-2.5 text-center border border-slate-100">
            <p className="text-xs text-slate-500 flex items-center justify-center gap-1"><IndianRupee size={10} /> Fees</p>
            <p className="font-bold text-slate-900 text-sm mt-0.5">
              {college.annual_fees_min >= 100000
                ? `${(college.annual_fees_min / 100000).toFixed(1)}L`
                : `${Math.round(college.annual_fees_min / 1000)}K`}/yr
            </p>
          </div>
        )}
      </div>

      <Button variant="secondary" size="sm" className="w-full" onClick={() => navigate(`/colleges/${college.id}`)}>
        View Profile →
      </Button>
    </Card>
  );
}
