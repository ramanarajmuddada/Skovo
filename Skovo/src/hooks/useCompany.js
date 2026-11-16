import { useEffect, useState } from 'react';
import { api } from '../services/api';
import { COMPANY } from '../config/company';

// Admin › Support › Company field -> key in config/company.js
const MAP = {
  legal_name: 'legalName',
  support_email: 'supportEmail',
  phone: 'phone',
  registered_address: 'registeredAddress',
  gstin: 'gstin',
  grievance_officer: 'grievanceOfficer',
  grievance_email: 'grievanceEmail',
  jurisdiction: 'jurisdiction',
  support_hours: 'supportHours',
};

let request = null;   // one fetch for every legal page in the session

const merge = (row) => {
  const out = { ...COMPANY };
  Object.entries(MAP).forEach(([apiKey, key]) => {
    const v = row?.[apiKey];
    if (v) out[key] = { value: v, PLACEHOLDER: false };
  });
  return out;
};

/**
 * Company details for the legal, contact and footer copy.
 * Admin values (GET /public/company) replace the config defaults; anything
 * Admin has not filled keeps its placeholder, so it still shows "To confirm".
 */
export default function useCompany() {
  const [company, setCompany] = useState(COMPANY);
  useEffect(() => {
    if (!request) {
      request = api.get('/public/company')
        .then(({ data }) => (data?.bool ? data.response : null))
        .catch(() => null);
    }
    let alive = true;
    request.then((row) => { if (alive && row) setCompany(merge(row)); });
    return () => { alive = false; };
  }, []);
  const hasPlaceholders = Object.values(company).some((f) => f && typeof f === 'object' && f.PLACEHOLDER);
  return { company, hasPlaceholders };
}
