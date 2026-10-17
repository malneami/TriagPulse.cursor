import { Bell, CheckCircle2, ClipboardList } from 'lucide-react';
import { ctasFill } from '@/lib/ctasStyle';

/**
 * Where the patient goes next. The header band uses the estimated CTAS colour
 * when the engine gives one; otherwise it stays ink so colour keeps meaning acuity.
 */
export default function DestinationScreen({
  destination, patientId, arrivalTime, directedTime,
  detectedSigns, respiratoryScore, onAlertTeam, onDone, onLogAndNew, elapsedSec,
}) {
  const mins = Math.floor(elapsedSec / 60);
  const secs = elapsedSec % 60;
  const timeStr = mins > 0 ? `${mins}:${String(secs).padStart(2, '0')} دقيقة` : `${secs} ثانية`;
  const isResus = destination.destination === 'RESUSCITATION' || destination.destination === 'PEDIATRIC_RESUS';
  const band = destination.estimated_ctas
    ? ctasFill(destination.estimated_ctas)
    : { backgroundColor: '#14202B', color: '#FFFFFF' };

  return (
    <div dir="rtl" className="max-w-2xl mx-auto flex flex-col gap-4 pb-8">
      <section className="bg-white rounded-2xl border border-mist overflow-hidden" aria-labelledby="dest-title">
        <div className="px-6 py-6 flex flex-col gap-1" style={band}>
          <p className="text-sm font-medium opacity-90">الوجهة · Destination</p>
          <h1 id="dest-title" className="text-3xl font-bold leading-tight">{destination.destination_ar}</h1>
          <p className="text-lg font-medium opacity-90">{destination.destination_en}</p>
          {destination.estimated_ctas && (
            <p className="text-sm font-semibold mt-1">CTAS {destination.estimated_ctas} مبدئي · estimated</p>
          )}
        </div>

        <dl className="grid grid-cols-2 sm:grid-cols-3 gap-px bg-mist border-b border-mist m-0">
          <div className="bg-white px-4 py-3">
            <dt className="text-xs text-graphite">رقم المريض · ID</dt>
            <dd dir="ltr" className="m-0 font-semibold text-ink text-end truncate">{patientId}</dd>
          </div>
          <div className="bg-white px-4 py-3">
            <dt className="text-xs text-graphite">الوصول · Arrival</dt>
            <dd className="m-0 font-semibold text-ink">{arrivalTime}</dd>
          </div>
          <div className="bg-white px-4 py-3">
            <dt className="text-xs text-graphite">المدة · Time</dt>
            <dd className="m-0 font-semibold text-ink">{timeStr}</dd>
          </div>
        </dl>

        <div className="px-6 py-5 flex flex-col gap-4">
          {destination.bypass_registration && (
            <p className="text-sm font-semibold text-ink border-2 border-ink rounded-xl px-3 py-2">
              تجاوز التسجيل: الفرز على السرير · Bypass registration, bedside triage
            </p>
          )}

          {detectedSigns.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold text-ink mb-1">العلامات المكتشفة · Signs detected</h2>
              <ul className="list-none m-0 p-0 flex flex-col gap-1">
                {detectedSigns.map((s, i) => (
                  <li key={i} className="text-sm text-ink flex gap-2">
                    <span aria-hidden="true" className="mt-2 w-1.5 h-1.5 rounded-full bg-[#D3242C] shrink-0" />{s}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {respiratoryScore > 0 && (
            <div className="flex items-center justify-between border border-mist rounded-xl px-4 py-2">
              <span className="text-sm text-graphite">درجة التنفس · Respiratory score</span>
              <span className="text-2xl font-bold text-ink tabular-nums">{respiratoryScore}</span>
            </div>
          )}

          <div>
            <h2 className="text-sm font-semibold text-ink mb-2">الإجراءات · Actions</h2>
            <ol className="list-none m-0 p-0 flex flex-col gap-2">
              {destination.actions_ar?.map((a, i) => (
                <li key={i} className="flex items-start gap-3">
                  <span className="w-7 h-7 rounded-full bg-paper text-ink text-sm font-semibold flex items-center justify-center shrink-0">{i + 1}</span>
                  <span>
                    <span className="block text-[15px] text-ink">{a}</span>
                    <span className="block text-xs text-graphite">{destination.actions_en?.[i]}</span>
                  </span>
                </li>
              ))}
            </ol>
          </div>

          <p className="text-xs text-graphite">وُجّه المريض الساعة {directedTime}</p>
        </div>
      </section>

      <div className="flex flex-col gap-2">
        {isResus && (
          <button
            type="button"
            onClick={onAlertTeam}
            className="w-full min-h-[56px] flex items-center justify-center gap-2 bg-[#D3242C] text-white font-semibold rounded-2xl text-base"
          >
            <Bell className="w-5 h-5" aria-hidden="true" />
            تنبيه الفريق · Alert team
          </button>
        )}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onDone}
            className="flex-1 min-h-[56px] flex items-center justify-center gap-2 bg-ink text-white font-semibold rounded-2xl text-base"
          >
            <CheckCircle2 className="w-5 h-5" aria-hidden="true" />
            {destination.bypass_registration ? 'متابعة إلى CTAS · Continue' : 'تم · Done'}
          </button>
          <button
            type="button"
            onClick={onLogAndNew}
            className="flex-1 min-h-[56px] flex items-center justify-center gap-2 bg-white border-2 border-ink text-ink font-semibold rounded-2xl text-base"
          >
            <ClipboardList className="w-5 h-5" aria-hidden="true" />
            مريض جديد · Next patient
          </button>
        </div>
      </div>
    </div>
  );
}
