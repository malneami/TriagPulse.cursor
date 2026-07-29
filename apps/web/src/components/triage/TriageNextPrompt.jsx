import { useNavigate } from 'react-router-dom';

function waitMins(iso) {
  if (!iso) return null;
  return Math.round((Date.now() - new Date(iso).getTime()) / 60000);
}

export default function TriageNextPrompt({ completedPatient, ctasLevel, nextPatient, onDismiss }) {
  const navigate = useNavigate();

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" dir="rtl">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-5 space-y-4">
        <div className="text-center">
          <p className="text-3xl mb-1">✅</p>
          <h2 className="text-base font-black text-slate-800">تم تأكيد الفرز — Triage Confirmed</h2>
          {completedPatient && (
            <p className="text-sm text-slate-500 mt-1">
              {completedPatient.patient_name_ar || completedPatient.patient_id}
              {ctasLevel ? ` — CTAS ${ctasLevel}` : ''}
            </p>
          )}
        </div>

        {nextPatient && (
          <div className="bg-teal-50 border border-teal-200 rounded-xl px-3 py-3 space-y-1">
            <p className="text-xs font-black text-teal-700">المريض التالي في الانتظار / Next waiting:</p>
            <p className="text-sm font-bold text-slate-800">
              {nextPatient.patient_name_ar || nextPatient.patient_id}
              {nextPatient.patient_id && nextPatient.patient_name_ar ? ` — ${nextPatient.patient_id}` : ''}
            </p>
            {nextPatient.arrival_time && (
              <p className="text-xs text-slate-500">
                ينتظر منذ {waitMins(nextPatient.arrival_time)} دقيقة
              </p>
            )}
          </div>
        )}

        <div className="flex flex-col gap-2">
          {nextPatient && (
            <button
              onClick={() => navigate(`/triage?pid=${encodeURIComponent(nextPatient.patient_id)}`)}
              className="w-full py-3 bg-teal-600 text-white rounded-xl font-black text-sm hover:bg-teal-700"
            >
              ▶ فرز المريض التالي / Triage Next
            </button>
          )}
          <button
            onClick={() => navigate('/tracking')}
            className="w-full py-3 bg-slate-100 text-slate-700 rounded-xl font-bold text-sm hover:bg-slate-200"
          >
            ← العودة للوحة / Back to Board
          </button>
        </div>
      </div>
    </div>
  );
}