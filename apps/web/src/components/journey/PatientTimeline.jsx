import { CheckCircle2, Circle, Loader2 } from 'lucide-react';
import { differenceInMinutes } from 'date-fns';

function fmtTime(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' }); } catch { return '—'; }
}

function elapsed(from, to) {
  if (!from || !to) return null;
  const diff = differenceInMinutes(new Date(to), new Date(from));
  return diff < 1 ? '< 1 د' : `${diff} د`;
}

export default function PatientTimeline({ journey }) {
  if (!journey) return null;

  const steps = [
    {
      ar: 'وصول', en: 'Arrived',
      time: journey.arrival_time,
      done: true,
      detail: null,
    },
    {
      ar: 'فرز بصري', en: 'Visual triage',
      time: journey.vt_completed_at,
      done: !!journey.vt_completed,
      active: false,
      detail: journey.vt_completed
        ? `${journey.vt_destination_ar || ''} ${journey.vt_duration_sec ? '· ' + journey.vt_duration_sec + 'ث' : ''}`
        : null,
    },
    {
      ar: 'تسجيل', en: 'Registration',
      time: journey.reg_completed_at,
      done: !!journey.reg_completed,
      active: !!journey.vt_completed && !journey.reg_completed,
      detail: journey.reg_completed ? elapsed(journey.arrival_time, journey.reg_completed_at) : null,
    },
    {
      ar: 'فرز CTAS', en: 'CTAS triage',
      time: journey.ctas_started_at,
      done: !!journey.ctas_level,
      active: !!journey.ctas_started_at && !journey.ctas_level,
      detail: journey.ctas_level ? `CTAS ${journey.ctas_level}` : journey.ctas_started_at ? 'جارٍ / In progress' : null,
    },
  ];

  const totalWait = journey.arrival_time && journey.ctas_started_at
    ? differenceInMinutes(new Date(journey.ctas_started_at), new Date(journey.arrival_time))
    : null;

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm px-4 py-3 mb-0">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-black text-slate-700">مسار المريض — Patient Journey</p>
        <span className="text-xs font-black text-red-600 bg-red-50 px-2 py-0.5 rounded-full">{journey.patient_id}</span>
      </div>
      <div className="flex items-start">
        {steps.map((step, i) => (
          <div key={i} className="flex items-start flex-1">
            <div className="flex flex-col items-center flex-1">
              <div className="flex items-center w-full">
                <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${
                  step.done ? 'bg-green-100' : step.active ? 'bg-blue-100' : 'bg-slate-100'
                }`}>
                  {step.done
                    ? <CheckCircle2 className="w-4 h-4 text-green-600" />
                    : step.active
                    ? <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />
                    : <Circle className="w-4 h-4 text-slate-300" />}
                </div>
                {i < steps.length - 1 && (
                  <div className={`flex-1 h-0.5 ${step.done ? 'bg-green-300' : 'bg-slate-200'}`} />
                )}
              </div>
              <div className="mt-1 text-center px-0.5">
                <p className={`text-xs font-bold ${step.done ? 'text-green-700' : step.active ? 'text-blue-600' : 'text-slate-400'}`}>
                  {step.ar}
                </p>
                {step.time && <p className="text-xs text-slate-400">{fmtTime(step.time)}</p>}
                {step.detail && <p className="text-xs text-slate-500">{step.detail}</p>}
              </div>
            </div>
          </div>
        ))}
      </div>
      {totalWait !== null && (
        <p className="text-xs text-slate-400 text-center mt-2 border-t border-slate-100 pt-2">
          إجمالي وقت الانتظار / Total wait: <span className="font-bold text-slate-600">{totalWait} دقيقة</span>
        </p>
      )}
    </div>
  );
}