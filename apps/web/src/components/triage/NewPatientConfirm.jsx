import { useNavigate } from 'react-router-dom';
import { X } from 'lucide-react';
import { base44 } from '@/api/base44Client';

export default function NewPatientConfirm({ currentPid, currentName, onCancel }) {
  const navigate = useNavigate();

  const handleSaveAndNew = async () => {
    if (currentPid) {
      // Find and update the journey status to in_progress so it stays on board
      const list = await base44.entities.PatientJourney.filter({ patient_id: currentPid });
      if (list?.[0]) {
        await base44.entities.PatientJourney.update(list[0].id, { current_status: 'ctas_in_progress' });
      }
    }
    navigate('/visual-triage');
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" dir="rtl">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-black text-slate-800">بدء مريض جديد</h2>
          <button onClick={onCancel}><X className="w-5 h-5 text-slate-400" /></button>
        </div>
        <p className="text-sm text-slate-600">
          هل تريد حفظ الفرز الحالي والبدء بمريض جديد؟<br />
          <span className="text-xs text-slate-400">Save current triage and start a new patient?</span>
        </p>
        {currentPid && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-xs space-y-0.5">
            <p className="font-black text-amber-800">الفرز الحالي / Current: {currentPid}</p>
            {currentName && <p className="text-amber-700">{currentName}</p>}
            <p className="text-amber-600">الحالة: سيُحفظ كـ "جارٍ / In progress"</p>
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
            className="w-full py-3 bg-slate-100 text-slate-600 rounded-xl font-bold text-sm hover:bg-slate-200"
          >
            ← إلغاء / Cancel
          </button>
        </div>
      </div>
    </div>
  );
}