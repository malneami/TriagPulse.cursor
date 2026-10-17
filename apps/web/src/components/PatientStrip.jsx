import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { api } from '@/api/client';
import { User, Hash } from 'lucide-react';
import EncounterLink from '@/components/journey/EncounterLink';

export default function PatientStrip() {
  const location = useLocation();
  const [patient, setPatient] = useState(null);

  const pid = new URLSearchParams(location.search).get('pid');

  useEffect(() => {
    if (!pid) { setPatient(null); return; }
    api.journeys.findByPatientId(pid)
      .then((j) => setPatient(j || null))
      .catch(() => setPatient(null));
  }, [pid]);

  if (!patient) return null;

  const name = patient.patient_name_ar || patient.patient_name_en || '—';
  const mrn  = patient.mrn || patient.id_number || pid;
  const age  = patient.age ? `${patient.age} سنة` : '';
  const gender = patient.gender === 'male' ? 'ذكر' : patient.gender === 'female' ? 'أنثى' : '';

  return (
    <div className="bg-white border-b border-mist" dir="rtl">
      <div className="max-w-[1600px] mx-auto px-4 sm:px-6 h-12 flex items-center gap-4 text-[15px]">
        <User className="w-4 h-4 shrink-0 text-graphite" aria-hidden="true" />
        <span className="font-semibold">{name}</span>
        {(age || gender) && (
          <span className="text-graphite">{[age, gender].filter(Boolean).join('، ')}</span>
        )}
        <span className="ms-auto flex items-center gap-1 text-graphite text-sm" dir="ltr">
          <Hash className="w-3.5 h-3.5" aria-hidden="true" />{mrn}
        </span>
        <EncounterLink journey={patient} onLinked={(j) => setPatient((p) => ({ ...p, ...j }))} />
      </div>
    </div>
  );
}