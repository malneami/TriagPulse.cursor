import { useState } from 'react';
import { Check, Pencil, Trash2, X, XCircle } from 'lucide-react';
import { formatTurnTime } from '@/lib/stt/ctasFieldMap';
import { REQUIRED_FIELDS } from './CompletenessChips';

const SOURCE_LABEL = {
  openai: 'AI',
  browser: 'Browser',
  manual: 'يدوي / Manual',
};

/**
 * Transcript turns + the fields extracted from them.
 *
 * Reads the transcript lines the panel already keeps; no separate turn store.
 */
export default function ConversationLog({ lines = [], patient = {}, onEditLine, onDeleteLine }) {
  const [editingIndex, setEditingIndex] = useState(null);
  const [draft, setDraft] = useState('');

  const startEdit = (i, text) => {
    setEditingIndex(i);
    setDraft(text);
  };

  const commitEdit = () => {
    if (editingIndex == null) return;
    const next = draft.trim();
    if (next) onEditLine?.(editingIndex, next);
    setEditingIndex(null);
    setDraft('');
  };

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100">
          <p className="text-sm font-black text-slate-800 text-center">
            سجل المحادثة — Conversation Log ({lines.length} turns)
          </p>
        </div>

        <div className="p-3 space-y-2 max-h-72 overflow-y-auto">
          {lines.length === 0 && (
            <p className="text-xs text-slate-400 text-center py-4">
              لا توجد محادثة بعد / No turns yet — press Record to begin
            </p>
          )}

          {lines.map((line, i) => {
            const text = typeof line === 'string' ? line : line.text;
            const source = typeof line === 'string' ? 'browser' : line.source;
            const at = typeof line === 'string' ? null : line.at;
            const editing = editingIndex === i;
            return (
              <div key={`${i}-${text.slice(0, 12)}`} className="bg-blue-50/60 border border-blue-100 rounded-xl px-3 py-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="flex items-center gap-1.5 text-xs font-black text-blue-700">
                        <span className="w-2 h-2 rounded-full bg-blue-500" /> المريض / Patient
                      </span>
                      <span className="text-[10px] text-slate-400">{formatTurnTime(at)}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500 font-bold">
                        {SOURCE_LABEL[source] || source}
                      </span>
                    </div>

                    {editing ? (
                      <textarea
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        rows={2}
                        autoFocus
                        className="w-full rounded-lg border border-blue-300 p-2 text-sm"
                      />
                    ) : (
                      <p className="text-sm text-slate-700 break-words">“{text}”</p>
                    )}
                  </div>

                  <div className="flex flex-col gap-1 shrink-0">
                    {editing ? (
                      <>
                        <button
                          type="button" onClick={commitEdit} aria-label="حفظ / Save"
                          className="p-1 rounded-md text-teal-700 hover:bg-teal-50"
                        >
                          <Check className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button" onClick={() => setEditingIndex(null)} aria-label="إلغاء / Cancel"
                          className="p-1 rounded-md text-slate-400 hover:bg-slate-100"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button" onClick={() => startEdit(i, text)} aria-label="تعديل / Edit"
                          className="p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button" onClick={() => onDeleteLine?.(i)} aria-label="حذف / Delete"
                          className="p-1 rounded-md text-slate-400 hover:text-red-600 hover:bg-red-50"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Extracted data */}
        <div className="border-t border-slate-100 bg-slate-50/60 px-4 py-3">
          <p className="text-xs font-black text-slate-600 mb-2">البيانات المستخرجة — Extracted data</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1">
            {REQUIRED_FIELDS.map((f) => {
              const done = f.check(patient);
              const value = done ? f.value?.(patient) : null;
              return (
                <div key={f.key} className="flex items-center justify-between gap-2 py-0.5">
                  <span className="text-xs text-slate-500 font-bold shrink-0">
                    {f.label_en} / {f.label_ar}
                  </span>
                  <span className={`flex items-center gap-1 text-xs min-w-0 ${done ? 'text-teal-700 font-bold' : 'text-slate-400 italic'}`}>
                    <span className="truncate">{done ? String(value) : 'missing'}</span>
                    {done
                      ? <Check className="w-3.5 h-3.5 shrink-0" strokeWidth={3} />
                      : <XCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
