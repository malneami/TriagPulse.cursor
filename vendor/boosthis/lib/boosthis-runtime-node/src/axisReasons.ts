/* ─── Boosthis: why a reading cannot be taken (Node) ─────────────────────
 *
 * The SHARED closed vocabulary every kit uses to say "this reading cannot be
 * taken here". The kit sends the CODE; the server owns the words (see the
 * server's axisAvailability). A kit may not send prose — anything a kit types
 * into a payload is untrusted text that could carry a customer's data, so the
 * ingest sanitizer strips it by design.
 *
 * Deliberately NOT a per-family numbering. A second vocabulary renders as a
 * blank "not available here" with no reason at all, because the server only
 * knows this one. Numbers are permanent: never re-use or renumber.
 *
 * Only the codes this kit actually sends are declared here. The full list of
 * eight lives on the server, which is the only place that turns one into a
 * sentence.
 */

/** The platform simply does not expose this number to an app. */
export const REASON_PLATFORM_DOES_NOT_EXPOSE = 3 as const;
/** The reading compares things this app has only one of — or has none of yet.
 *  There is no edge to measure against, so "how close are you" has no answer
 *  and inventing a ceiling would be the invented number the reading refuses. */
export const REASON_NOTHING_TO_COMPARE = 6 as const;
/** The app runs somewhere that blocks the reading (sandbox, locked-down host). */
export const REASON_BLOCKED_BY_ENVIRONMENT = 8 as const;
/** The reading is real and the meter is working — the numbers themselves move
 *  too much for a trend fitted to them to say which way they are going. Not a
 *  host limit and not a wait for the first sample: the samples are here, and a
 *  later, calmer window can still produce a verdict. Sent WITHOUT
 *  `measurable: 0`, so surfaces word it as a withheld verdict rather than as a
 *  reading that cannot be taken. */
export const REASON_TREND_INSIDE_NOISE = 9 as const;
