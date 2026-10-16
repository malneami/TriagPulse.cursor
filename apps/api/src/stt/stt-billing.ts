/**
 * Remembers that OpenAI refused speech for lack of credits. The status check only
 * lists models (which still works with no credits), so without this the app kept
 * offering bilingual live speech, failed on every recording and fell back silently.
 * The flag expires so the app tries again after credits are added.
 */
const BLOCK_MS = 10 * 60 * 1000;
let blockedAt = 0;

export const BILLING_MESSAGE = 'OpenAI account has no credits remaining — add billing credits to restore Arabic + English speech.';

export function markOpenAiBillingBlocked() { blockedAt = Date.now(); }
export function clearOpenAiBillingBlocked() { blockedAt = 0; }
export function openAiBillingBlocked() { return blockedAt > 0 && Date.now() - blockedAt < BLOCK_MS; }
