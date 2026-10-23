/**
 * A refused upload, said once — and the one refusal that renews a credential.
 *
 * WHY THIS IS ITS OWN MODULE
 * --------------------------
 * The served setup guide tells a developer to look at the process's log when
 * nothing arrives, and until now this kit wrote nothing there when Boosthis
 * refused an upload: the status page and the panel recorded the refusal, and
 * neither is open while somebody is reading the log. This module holds the one
 * line that fills that gap, its one-per-process-and-reason latch, and the test
 * that decides whether a refusal is the kind that renewing the credential can
 * fix.
 *
 * Everything here is read from the HTTP status and frozen machine-readable
 * fields only — never from server prose — and nothing here ever carries the
 * project key, a credential, an endpoint or an install id. The class names are
 * the same in every kit.
 */

import { readAnswerJson } from "./answerRead";
import { sayAfterStartupLine } from "./startAnnounce";

/** The machine-readable field a 401 carries to say why the credential was
 *  refused, and the one value of it that renews. Frozen wire names. */
export const CREDENTIAL_REFUSAL_FIELD = "credentialRefusal";
export const CREDENTIAL_MISMATCH = "mismatch";

/** The fields of a refusal body this kit reads. Everything else is ignored. */
export interface RefusalBody {
  error?: unknown;
  credentialRefusal?: unknown;
}

/** A refusal body is a few dozen bytes. Anything far larger is not one. */
const REFUSAL_BODY_MAX_BYTES = 4096;
/** And it is read quickly or not at all: an upload path must not wait on it. */
const REFUSAL_BODY_READ_MS = 2_000;

/** The refusal fields of a credential refusal (401 / 403), or null for any
 *  other answer or a body that cannot be read. Reads a copy where the answer
 *  can make one, so the answer itself stays readable. Never throws. */
export async function readCredentialRefusal(
  res: Response,
): Promise<RefusalBody | null> {
  try {
    if (res.status !== 401 && res.status !== 403) return null;
    const source =
      typeof (res as { clone?: unknown }).clone === "function"
        ? res.clone()
        : res;
    const body = (await readAnswerJson(source, {
      maxBytes: REFUSAL_BODY_MAX_BYTES,
      timeoutMs: REFUSAL_BODY_READ_MS,
    })) as RefusalBody | null;
    return body && typeof body === "object" ? body : null;
  } catch {
    return null;
  }
}

/** True only for the one refusal that renews: a 401 saying the presented
 *  credential is not the one on file because it was replaced. A cut-off
 *  install, a missing credential and one Boosthis holds nothing for are
 *  never renewed — renewing cannot change any of them. */
export function isCredentialMismatch(
  status: number,
  body: RefusalBody | null,
): boolean {
  if (status !== 401 || !body) return false;
  if (body.error === "credentials_cut") return false;
  return body[CREDENTIAL_REFUSAL_FIELD] === CREDENTIAL_MISMATCH;
}

/** Why Boosthis refused an upload, in the kit's own closed words. */
export type UploadRefusal =
  | "credential-replaced"
  | "credential-missing"
  | "credential-not-on-file"
  | "credentials-cut"
  | "credential-refused"
  | "unknown-install"
  | "rate-limited"
  | "batch-refused";

/** The refusal class of an answer, or null when it is not a refusal: a
 *  success, or the server failing on its own side. */
export function uploadRefusalOf(
  status: number,
  body: RefusalBody | null,
): UploadRefusal | null {
  if (status < 400 || status >= 500) return null;
  if (status === 401 || status === 403) {
    if (body?.error === "credentials_cut") return "credentials-cut";
    switch (body?.[CREDENTIAL_REFUSAL_FIELD]) {
      case CREDENTIAL_MISMATCH:
        // Only a 401 renews, so only a 401 can say renewing did not help.
        return status === 401 ? "credential-replaced" : "credential-refused";
      case "missing":
        return "credential-missing";
      case "not_on_file":
        return "credential-not-on-file";
      default:
        return "credential-refused";
    }
  }
  if (status === 404) return "unknown-install";
  if (status === 429) return "rate-limited";
  return "batch-refused";
}

/** The plain-words reason the log line names. */
export function uploadRefusalText(refusal: UploadRefusal): string {
  switch (refusal) {
    case "credential-replaced":
      return "this process's credential was replaced when another copy of this app reconnected, and renewing it did not bring back one that works";
    case "credential-missing":
      return "the upload reached Boosthis without this install's credential";
    case "credential-not-on-file":
      return "Boosthis holds no credential on file for this install";
    case "credentials-cut":
      return "the project's owner cut off this install's credentials";
    case "credential-refused":
      return "Boosthis did not accept this install's credential";
    case "unknown-install":
      return "Boosthis does not know this install id";
    case "rate-limited":
      return "Boosthis is limiting how often this app may send";
    default:
      return "Boosthis refused the batch itself";
  }
}

/** The whole log line for one refusal. */
export function uploadRefusalLine(refusal: UploadRefusal): string {
  return (
    `[boosthis] Uploads are not getting through: ${uploadRefusalText(refusal)}. ` +
    "Open this project's page on your Boosthis dashboard to see what changed."
  );
}

/** Which reasons this process has already said. */
const warnedRefusals = new Set<UploadRefusal>();

/** Write ONE log warning per process and refusal reason when Boosthis refuses
 *  an upload. The status page and the panel already record the refusal; this
 *  says which refusal it was where the developer is already looking. Never
 *  ahead of the startup line, never the key, a credential or server text, and
 *  never throws into the host. */
export function noteUploadRefusedOnce(
  status: number,
  body: RefusalBody | null,
): void {
  try {
    const refusal = uploadRefusalOf(status, body);
    if (refusal === null || warnedRefusals.has(refusal)) return;
    warnedRefusals.add(refusal);
    sayAfterStartupLine(uploadRefusalLine(refusal));
  } catch {
    // A warning must never fail an upload.
  }
}

/** Test-only: forget which refusals this process has said. */
export function _resetUploadRefusalWarningsForTests(): void {
  warnedRefusals.clear();
}
