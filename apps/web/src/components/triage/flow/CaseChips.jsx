import { AlertTriangle, Pill, X } from 'lucide-react';
import { ctasSwatch } from '@/lib/ctasStyle';
import { drugClassLabel } from '@/lib/caseModel';

function LevelDot({ level }) {
  if (!level) return null;
  return (
    <span className="inline-flex items-center gap-1 text-xs font-semibold tabular-nums">
      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={ctasSwatch(level)} aria-hidden="true" />
      {level}
    </span>
  );
}

/**
 * Every presenting complaint. The most urgent one sets CTAS unless the nurse makes
 * another the primary; a wrong one can be removed.
 */
export function ComplaintChips({ cc, onMakePrimary, onRemove }) {
  if (!cc.complaints.length) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <ul className="flex flex-wrap gap-1.5 list-none m-0 p-0" aria-label="الشكاوى / Complaints">
        {cc.complaints.map((c) => {
          const primary = cc.primary?.id === c.id;
          return (
            <li key={c.id} className={`flex items-center rounded-full border ${primary ? 'bg-ink text-white border-ink' : 'bg-white text-ink border-mist'}`}>
              <button
                type="button"
                onClick={() => !primary && onMakePrimary(c)}
                aria-pressed={primary}
                aria-label={`${c.label_ar} / ${c.label_en}${c.level ? `, CTAS ${c.level}` : ''}${primary ? ' — يحدد المستوى / sets the level' : ' — اجعلها الرئيسية / make primary'}`}
                className="min-h-[36px] ps-3 pe-2 flex items-center gap-2 text-sm font-semibold"
              >
                <span>{c.label_ar}<span className={`font-normal ${primary ? 'text-white/80' : 'text-graphite'}`}> · {c.label_en}</span></span>
                <LevelDot level={c.level} />
                {primary && <span className="text-[11px] font-normal text-white/80">يحدد المستوى</span>}
              </button>
              {cc.complaints.length > 1 && (
                <button
                  type="button"
                  onClick={() => onRemove(c)}
                  aria-label={`إزالة / Remove ${c.label_en}`}
                  className={`w-9 h-9 rounded-full flex items-center justify-center ${primary ? 'text-white/80 hover:bg-white/10' : 'text-graphite hover:bg-paper'}`}
                >
                  <X className="w-4 h-4" aria-hidden="true" />
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {cc.complaints.length > 1 && !cc.chosenByNurse && (
        <p className="text-xs text-graphite">الأكثر إلحاحاً يحدد المستوى؛ اضغط على شكوى لجعلها الرئيسية · The most urgent sets the level; tap one to make it primary</p>
      )}
      {cc.primaryLessUrgent && (
        <p role="status" className="text-sm text-[#D3242C] font-semibold flex items-start gap-1.5">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
          يبقى CTAS {cc.mostUrgent.level} بسبب «{cc.mostUrgent.label_ar}»؛ للخفض استخدم «تغيير» مع السبب · CTAS stays {cc.mostUrgent.level} because of “{cc.mostUrgent.label_en}”; to lower it use Change with a reason
        </p>
      )}
    </div>
  );
}

/**
 * Chronic illnesses and regular medicines. Present, absent and probable (implied by a
 * medicine) are shown differently; nothing is filled in by assumption.
 */
export function HistoryChips({ cc, onRemoveCondition }) {
  const present = cc.conditions.filter((c) => c.status === 'present');
  const probable = cc.conditions.filter((c) => c.status === 'probable');
  const absent = cc.conditions.filter((c) => c.status === 'absent');
  const empty = !present.length && !probable.length && !absent.length && !cc.medications.length;

  return (
    <div className="flex flex-col gap-1.5" aria-label="الأمراض المزمنة والأدوية / History and medicines">
      <p className="text-xs text-graphite">الأمراض المزمنة والأدوية · History & medicines</p>
      <ul className="flex flex-wrap gap-1.5 list-none m-0 p-0">
        {empty && (
          <li className={`min-h-[32px] px-3 rounded-full text-sm flex items-center ${cc.noKnownHistory ? 'bg-paper text-ink' : 'border border-dashed border-[#D3242C]/50 text-graphite'}`}>
            {cc.noKnownHistory ? 'لا أمراض مزمنة · No chronic illness' : 'لم يُذكر بعد · Not mentioned yet'}
          </li>
        )}
        {present.map((c) => (
          <li key={c.id} className="flex items-center rounded-full bg-paper text-ink">
            <span className="ps-3 pe-1 min-h-[32px] flex items-center gap-1.5 text-sm font-semibold">
              {c.high_risk && <span className="w-2 h-2 rounded-full bg-[#D3242C]" aria-hidden="true" />}
              {c.label_ar}<span className="font-normal text-graphite"> · {c.label_en}</span>
              {c.high_risk && <span className="sr-only">(عالي الخطورة / high risk)</span>}
            </span>
            <button type="button" onClick={() => onRemoveCondition(c)} aria-label={`إزالة / Remove ${c.label_en}`} className="w-8 h-8 rounded-full flex items-center justify-center text-graphite hover:bg-mist">
              <X className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </li>
        ))}
        {probable.map((c) => (
          <li key={c.id} className="flex items-center rounded-full border border-dashed border-mist text-ink">
            <span className="ps-3 pe-1 min-h-[32px] flex items-center text-sm">
              {c.label_ar} محتمل<span className="text-graphite"> · probable {c.label_en}</span>
            </span>
            <button type="button" onClick={() => onRemoveCondition(c)} aria-label={`إزالة / Remove ${c.label_en}`} className="w-8 h-8 rounded-full flex items-center justify-center text-graphite hover:bg-paper">
              <X className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </li>
        ))}
        {absent.map((c) => (
          <li key={c.id} className="min-h-[32px] px-3 rounded-full border border-mist text-graphite text-sm flex items-center">
            لا {c.label_ar} · no {c.label_en}
          </li>
        ))}
        {cc.medications.map((m) => (
          <li key={m.name} className="min-h-[32px] px-3 rounded-full border border-mist bg-white text-ink text-sm flex items-center gap-1.5">
            <Pill className="w-3.5 h-3.5 text-graphite" aria-hidden="true" />
            <span className="font-semibold" dir="auto">{m.name}</span>
            {(() => {
              // Skip a class that only repeats the name (insulin · insulin).
              const cls = m.classes.filter((c) => !String(drugClassLabel(c)).toLowerCase().includes(String(m.name).toLowerCase()));
              return cls.length > 0 && <span className="text-graphite">· {cls.map(drugClassLabel).join('، ')}</span>;
            })()}
          </li>
        ))}
      </ul>
      {present.some((c) => c.high_risk) && (
        <p className="text-xs text-graphite flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-[#D3242C]" aria-hidden="true" />
          عالي الخطورة (للاطلاع، لا يغيّر CTAS حالياً) · High-risk history (for awareness; does not change CTAS yet)
        </p>
      )}
    </div>
  );
}
