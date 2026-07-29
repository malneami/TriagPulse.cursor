import { useState, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { Camera, RefreshCw, CheckCircle2, Loader2, ScanLine } from 'lucide-react';
import { toast } from 'sonner';

export default function ReceiptScanner({ onExtracted, receiptUrl }) {
  const [scanning, setScanning] = useState(false);
  const inputRef = useRef(null);

  const handleFile = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setScanning(true);

    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });

      const today = new Date().toISOString().split('T')[0];

      const raw = await base44.integrations.Core.InvokeLLM({
        model: "claude_sonnet_4_6",
        prompt: `You are an expert bilingual (Arabic/English) medical OCR specialist. Your task is to extract structured patient data from a Saudi hospital triage or registration form image. The form may be printed, handwritten, or a mix of both.

TODAY'S DATE: ${today}

== STEP 1 — VISUAL ANALYSIS ==
Before extracting, carefully:
- Read ALL printed text including small fonts, stamps, and stickers
- Read ALL handwritten text (look for ink/pencil annotations in blanks/boxes)
- Identify checked boxes: ☑ ✓ ✗ filled circle ● or any mark inside a box counts as "checked"
- Identify unchecked boxes: □ ○ empty — these are NOT selected
- Read barcodes or QR code labels if any alphanumeric text is adjacent

== STEP 2 — FIELD EXTRACTION RULES ==

"mrn": 
  - Labels: 'File No.', 'رقم الملف', 'File', 'MRN', 'Patient ID', 'رقم المريض', 'Chart No.'
  - Usually a 6–10 digit number. May appear on a barcode label sticker.

"patient_name_ar": 
  - Labels: 'اسم المريض', 'الاسم', 'الاسم بالعربي', 'Patient Name (Arabic)'
  - Extract Arabic name exactly as written (handwritten or printed).

"patient_name_en": 
  - Labels: 'Patient Name', 'Name', 'الاسم بالإنجليزي'
  - Extract Latin/English name exactly as written.

"age": 
  - Labels: 'Age', 'العمر', 'AGE'
  - If not explicitly stated, calculate from DOB using today's date (${today}). Round down to whole years.

"date_of_birth": 
  - Labels: 'DOB', 'D.O.B', 'تاريخ الميلاد', 'Date of Birth'
  - Return as printed (e.g., "15/03/1990").

"gender": 
  - ONLY return "male" or "female".
  - Checkbox detection: if the male/ذكر box is checked → "male"; if female/أنثى box is checked → "female".
  - Text clues: "M", "Male", "ذكر" → "male". "F", "Female", "أنثى" → "female".

"nationality": 
  - Labels: 'Nationality', 'الجنسية', 'Nat.'
  - Return full text as printed (e.g., "Saudi / سعودي", "Egyptian", "يمني").

"phone": 
  - Labels: 'Mobile', 'Tel', 'Phone', 'الجوال', 'رقم الهاتف', 'Contact'
  - Return digits only, no spaces/dashes/brackets. Saudi numbers start with 05.

"insurance": 
  - Labels: 'Payer', 'Paying Authority', 'الجهة', 'جهة العلاج', 'Insurance', 'التأمين'
  - If 'Cash' or 'نقدي' → "Cash / نقدي". Otherwise return the payer/insurer name as written.

"attending_physician": 
  - Labels: 'Doctor', 'Physician', 'Dr.', 'الطبيب', 'اسم الطبيب'
  - Return name as printed or written.

== STEP 3 — OUTPUT ==
Return ONLY a strict JSON object. No markdown. No explanation. No extra keys.
If a field is genuinely not present or unreadable, set it to null.
Never guess or infer a value that isn't visually present in the image.

{"patient_name_ar":...,"patient_name_en":...,"mrn":...,"age":...,"date_of_birth":...,"gender":...,"nationality":...,"phone":...,"insurance":...,"attending_physician":...}`,
        file_urls: [file_url],
      });

      // raw may be a string (claude) or already parsed object
      let result;
      if (typeof raw === 'string') {
        const match = raw.match(/\{[\s\S]*\}/);
        result = match ? JSON.parse(match[0]) : {};
      } else {
        result = raw;
      }

      onExtracted(result, file_url);
      toast.success('تم استخراج بيانات المريض');
    } catch (err) {
      toast.error('فشل استخراج البيانات — ' + err.message);
    } finally {
      setScanning(false);
      e.target.value = '';
    }
  };

  return (
    <div className="bg-white rounded-2xl border-2 border-dashed border-teal-200 p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="font-bold text-slate-800 text-base">مسح استمارة الاستقبال</h3>
          <p className="text-xs text-slate-500">Scan Registration Form</p>
        </div>
        <ScanLine className="w-6 h-6 text-teal-500" />
      </div>

      {receiptUrl ? (
        <div className="flex items-center gap-3">
          <img src={receiptUrl} alt="receipt" className="w-16 h-16 object-cover rounded-lg border border-slate-200" />
          <div className="flex-1">
            <div className="flex items-center gap-1.5 text-green-700 text-sm font-medium mb-1">
              <CheckCircle2 className="w-4 h-4" />
              تم استخراج البيانات
            </div>
            <button
              onClick={() => inputRef.current?.click()}
              className="text-xs text-teal-600 underline flex items-center gap-1"
            >
              <RefreshCw className="w-3 h-3" /> إعادة المسح
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => inputRef.current?.click()}
          disabled={scanning}
          className="w-full flex flex-col items-center gap-2 py-5 rounded-xl bg-teal-50 hover:bg-teal-100 border border-teal-200 transition-colors"
        >
          {scanning ? (
            <>
              <Loader2 className="w-8 h-8 text-teal-600 animate-spin" />
              <span className="text-sm text-teal-700 font-medium">جارٍ تحليل الاستمارة...</span>
            </>
          ) : (
            <>
              <Camera className="w-8 h-8 text-teal-500" />
              <span className="text-sm text-teal-700 font-medium">التقط صورة الاستمارة</span>
              <span className="text-xs text-slate-500">Capture / Upload Receipt</span>
            </>
          )}
        </button>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleFile}
        className="hidden"
      />
    </div>
  );
}