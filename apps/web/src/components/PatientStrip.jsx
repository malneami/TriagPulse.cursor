import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { User, Hash } from 'lucide-react';

export default function PatientStrip() {
  const location = useLocation();
  const [patient, setPatient] = useState(null);

  const pid = new URLSearchParams(location.search).get('pid');

  useEffect(() => {
    if (!pid) { setPatient(null); return; }
    base44.entities.PatientJourney.filter({ patient_id: pid })
      .then(list => setPatient(list?.[0] || null))
      .catch(() => setPatient(null));
  }, [pid]);

  if (!patient) return null;

  const name = patient.patient_name_ar || patient.patient_name_en || '—';
  const mrn  = patient.mrn || patient.id_number || pid;
  const age  = patient.age ? `${patient.age} سنة` : '';
  const gender = patient.gender === 'male' ? 'ذكر' : patient.gender === 'female' ? 'أنثى' : '';

  return (
    <div className="bg-teal-700 text-white px-4 py-1.5 flex items-center gap-3 text-sm" dir="rtl">
      <User className="w-3.5 h-3.5 shrink-0 opacity-70" />
      <span className="font-black">{name}</span>
      {(age || gender) && (
        <span className="text-teal-200 text-xs">{[age, gender].filter(Boolean).join(' · ')}</span>
      )}
      <span className="mr-auto flex items-center gap-1 text-teal-200 text-xs font-mono">
        <Hash className="w-3 h-3" />{mrn}
      </span>
    </div>
  );
}