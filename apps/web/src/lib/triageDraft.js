/**
 * Draft autosave for the triage in progress (review H6).
 *
 * A refresh, a crash or the 15-minute idle lock used to lose the patient being triaged.
 * The open triage is now kept per nurse and per patient in sessionStorage:
 * - sessionStorage, not localStorage: it lives only in this browser tab and is gone when
 *   the tab closes, so patient data does not stay on a shared ED workstation.
 * - Removed when the triage is saved, when the nurse discards it, and on a manual sign-out.
 * - Kept through the idle lock, so the same nurse signs back in and carries on.
 * - Ignored after 2 hours.
 */

const PREFIX = 'tp_draft:';
export const DRAFT_MAX_AGE_MS = 2 * 60 * 60 * 1000;

export function draftKey(userId, pid) {
  return `${PREFIX}${userId || 'anon'}:${pid || 'unlinked'}`;
}

function store() {
  try { return window.sessionStorage; } catch { return null; }
}

export function saveDraft(key, data) {
  const s = store();
  if (!s) return;
  try { s.setItem(key, JSON.stringify({ v: 1, at: Date.now(), ...data })); } catch { /* quota or blocked */ }
}

export function loadDraft(key, now = Date.now()) {
  const s = store();
  if (!s) return null;
  try {
    const raw = s.getItem(key);
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (!d || d.v !== 1 || !d.at || now - d.at > DRAFT_MAX_AGE_MS) {
      s.removeItem(key);
      return null;
    }
    return d;
  } catch {
    return null;
  }
}

export function clearDraft(key) {
  const s = store();
  if (!s) return;
  try { s.removeItem(key); } catch { /* ignore */ }
}

/** Every draft in this tab (manual sign-out). */
export function clearAllDrafts() {
  const s = store();
  if (!s) return;
  try {
    for (let i = s.length - 1; i >= 0; i -= 1) {
      const k = s.key(i);
      if (k && k.startsWith(PREFIX)) s.removeItem(k);
    }
  } catch { /* ignore */ }
}

/** True when the patient has anything worth keeping. */
export function hasTriageWork(patient, answers = {}) {
  if (!patient) return false;
  const keys = ['chief_complaint', 'transcription', 'hr', 'bp_systolic', 'spo2', 'rr', 'temperature', 'gcs', 'pain_score'];
  return keys.some((k) => patient[k] != null && String(patient[k]).trim() !== '') || Object.keys(answers || {}).length > 0;
}
