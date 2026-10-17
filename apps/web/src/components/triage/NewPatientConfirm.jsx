import { useNavigate } from 'react-router-dom';
import { X } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/api/client';

export default function NewPatientConfirm({ currentPid, currentName, onCancel, onLeave }) {
  const navigate = useNavigate();

  const handleSaveAndNew = async () => {
    if (currentPid) {
      // Keep the current patient on the board as "CTAS in progress".
      try {
        const journey = await api.journeys.findByPatientId(currentPid);
        if (journey) await api.journeys.startCtas(journey.id);
      } catch (err) {
        console.error(err);
        toast.error('تعذّر تحديث حالة المريض — Could not update patient status');
        return;
      }
    }
    onLeave?.();
    navigate('/visual-triage');
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" dir="rtl">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-black text-ink">بدء مريض جديد</h2>
          <button onClick={onCancel}><X className="w-5 h-5 text-graphite" /></button>
        </div>
        <p className="text-sm text-graphite">
          هل تريد حفظ الفرز الحالي والبدء بمريض جديد؟<br />
          <span className="text-xs text-graphite">Save current triage and start a new patient?</span>
        </p>
        {currentPid && (
          <div className="bg-paper border border-mist rounded-xl px-3 py-2 text-xs space-y-0.5">
            <p className="font-black text-ink">الفرز الحالي / Current: {currentPid}</p>
            {currentName && <p className="text-graphite">{currentName}</p>}
            <p className="text-graphite">الحالة: سيُحفظ كـ "جارٍ / In progress"</p>
          </div>
        )}
        <div className="flex flex-col gap-2">
          <button
            onClick={handleSaveAndNew}
            className="w-full py-3 bg-red-600 text-white rounded-xl font-black text-sm hover:bg-red-700"
          >
            ✅ حفظ وبدء جديد / Save & Start New
          </button>
          <button
            onClick={onCancel}
            className="w-full py-3 bg-paper text-graphite rounded-xl font-bold text-sm hover:bg-mist"
          >
            ← إلغاء / Cancel
          </button>
        </div>
      </div>
    </div>
  );
}