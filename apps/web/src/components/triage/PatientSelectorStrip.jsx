import { useState, useEffect } from 'react';
import { api } from '@/api/client';
import { ChevronDown, X, Camera, Link2 } from 'lucide-react';
import { toast } from 'sonner';
import { EncounterDialog } from '@/components/journey/EncounterLink';
import { ticketCode } from '@/lib/ticket';

function waitMins(iso) {
  if (!iso) return null;
  return Math.round((Date.now() - new Date(iso).getTime()) / 60000);
}

/**
 * "المريض" box on the CTAS page: pick a waiting patient, and read or type the visit
 * ticket's Transaction No. With a linked patient the number is saved on that patient.
 * With no patient yet, a number that already belongs to a patient opens that patient;
 * otherwise it is kept and saved with the new patient when the triage is saved.
 */
export default function PatientSelectorStrip({ currentPid, onSwitch, journey = null, pendingEncounter = '', onPendingEncounter, onLinked }) {
  const [open, setOpen] = useState(false);
  const [patients, setPatients] = useState([]);
  const [encOpen, setEncOpen] = useState(false);

  useEffect(() => {
    api.journeys.listActive().then(all => {
      const cutoff = Date.now() - 12 * 60 * 60 * 1000;
      setPatients(all.filter(p =>
        new Date(p.arrival_time).getTime() > cutoff &&
        ['ctas_pending', 'ctas_in_progress', 'registration'].includes(p.current_status)
      ));
    });
  }, [currentPid]);

  const current = patients.find(p => p.patient_id === currentPid);
  const others = patients.filter(p => p.patient_id !== currentPid);

  const displayName = (p) => {
    if (!p) return 'مجهول / Unknown';
    const name = p.patient_name_ar || p.patient_name_en;
    return name || 'مجهول / Unknown';
  };

  const encounter = journey?.encounter_no || (!journey ? pendingEncounter : '');
  const pickEncounter = async (no) => {
    const found = await api.journeys.findByEncounter(no);
    if (found && found.patient_id !== currentPid) {
      toast.success(`${ticketCode(found.ticket_no)} — فتح المريض المرتبط بهذا الرقم / Opening the patient with this Transaction No.`);
      onSwitch(found.patient_id);
      return;
    }
    onPendingEncounter?.(no);
    toast.success(`رقم العملية ${no} سيُحفظ مع المريض الجديد / Will be saved with the new patient`);
  };

  return (
    <div className="relative">
      <div className="w-full h-12 bg-white border border-mist text-ink rounded-2xl shadow-sm flex items-center hover:border-ink">
      <button
        onClick={() => setOpen(v => !v)}
        type="button"
        aria-expanded={open}
        className="flex-1 min-w-0 h-full ps-4 pe-2 flex items-center justify-between gap-2 rounded-s-2xl"
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-graphite text-sm shrink-0">المريض:</span>
          <span className="text-[15px] font-semibold truncate">
            {currentPid ? `${displayName(current)} · ${currentPid}` : 'غير مرتبط بمريض · No patient linked'}
          </span>
          {current?.age && <span className="text-graphite text-sm shrink-0">{current.age} سنة</span>}
          {current?.vt_destination_ar && <span className="text-graphite text-xs shrink-0 hidden sm:block">— {current.vt_destination_ar}</span>}
        </div>
        <ChevronDown className={`w-4 h-4 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      <button
        type="button"
        onClick={() => setEncOpen(true)}
        title={encounter ? 'رقم العملية / Transaction No.' : 'قراءة رقم العملية بالكاميرا / Read the Transaction No. with the camera'}
        className={`h-10 me-1 px-3 rounded-xl flex items-center gap-1.5 text-sm font-semibold shrink-0 ${
          encounter ? 'border border-mist text-ink' : 'bg-ink text-white'
        }`}
      >
        {encounter ? <Link2 className="w-4 h-4" aria-hidden="true" /> : <Camera className="w-4 h-4" aria-hidden="true" />}
        <span dir="ltr">{encounter || 'Transaction No.'}</span>
        {!encounter && <span className="hidden md:inline">· رقم العملية</span>}
      </button>
      </div>
      <EncounterDialog
        journey={journey}
        open={encOpen}
        onOpenChange={setEncOpen}
        onLinked={onLinked}
        onPick={pickEncounter}
        initialValue={!journey ? pendingEncounter : ''}
      />

      {open && (
        <div className="absolute top-full right-0 left-0 mt-1 bg-white border border-mist rounded-xl shadow-xl z-50 overflow-hidden">
          <div className="px-4 py-2 border-b border-mist flex items-center justify-between">
            <span className="text-xs font-black text-graphite">اختر مريضاً — Select Patient</span>
            <button onClick={() => setOpen(false)}><X className="w-4 h-4 text-graphite" /></button>
          </div>

          {current && (
            <div className="px-4 py-2.5 bg-paper border-b border-mist flex items-center justify-between">
              <div>
                <span className="text-sm font-semibold text-ink">{displayName(current)}</span>
                <span className="text-xs text-graphite mr-2">{currentPid}</span>
                {current.age && <span className="text-xs text-graphite">{current.age} سنة</span>}
              </div>
              <span className="text-xs bg-ink text-white px-2 py-0.5 rounded-full font-semibold">جارٍ / Current</span>
            </div>
          )}

          {others.map(p => {
            const wm = waitMins(p.arrival_time);
            return (
              <button
                key={p.id}
                onClick={() => { setOpen(false); onSwitch(p.patient_id); }}
                className="w-full px-4 py-2.5 flex items-center justify-between hover:bg-paper border-b border-mist last:border-0"
              >
                <div className="text-right">
                  <span className="text-sm font-bold text-ink">{displayName(p)}</span>
                  <span className="text-xs text-graphite mr-2">{p.patient_id}</span>
                  {p.age && <span className="text-xs text-graphite">{p.age} سنة</span>}
                </div>
                <span className="text-xs text-graphite">
                  {wm != null ? `${wm} د` : '—'}
                </span>
              </button>
            );
          })}

          {others.length === 0 && !current && (
            <div className="px-4 py-4 text-center text-sm text-graphite">لا يوجد مرضى في انتظار الفرز · No patients waiting — use «مريض جديد»</div>
          )}

        </div>
      )}
    </div>
  );
}