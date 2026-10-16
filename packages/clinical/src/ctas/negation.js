/**
 * "Is this finding negated?" for a detection pattern.
 *
 * The negation must be a whole word ("no", "denies", «لا», «بدون»…) and sit at most
 * three words before the finding within the same clause. Without word boundaries
 * "no" matched inside "known" and «لا» inside ordinary words (الاسهال، خلال), so
 * "known asthmatic, has stridor" was read as "no stridor".
 * @param {string} patternSource  source of the finding's RegExp
 * @returns {RegExp}
 */
export function negatedFindingRegex(patternSource) {
  const neg = '(?:no|not|denies|denied|without|negative\\s+for|free\\s+of|never'
    + '|بدون|ليس|ليست|ينفي|تنفي|لا(?:\\s+(?:يوجد|توجد|يوجد\\s+لديه|يعاني\\s+من|تعاني\\s+من))?'
    + '|ما\\s*(?:في|فيه|فيها|عنده|عندها))';
  // "non-cardiac" / "non cardiac" / «غير قلبي» negate the word they are attached to.
  const prefix = '(?:non[-\\s]?|غير\\s+)';
  return new RegExp(`(?:(?:^|[\\s,.،؛:;(])${neg}\\s+(?:[^\\s.,،؛;!?]+\\s+){0,3}?|(?:^|[\\s,.،؛:;(])${prefix})(?:${patternSource})`, 'i');
}

/**
 * How a finding is stated in the conversation:
 * 'positive' (only stated), 'negative' (only denied), 'both' (denied AND stated, e.g.
 * "no bleeding … patient still bleeding") or null (not mentioned). 'both' is asked,
 * never resolved to "no" silently.
 * @param {RegExp} re
 * @param {string} ctx
 * @returns {'positive'|'negative'|'both'|null}
 */
export function findingStatus(re, ctx) {
  if (!re.test(ctx)) return null;
  const neg = negatedFindingRegex(re.source);
  if (!neg.test(ctx)) return 'positive';
  const rest = ctx.replace(new RegExp(neg.source, 'gi'), ' ');
  return re.test(rest) ? 'both' : 'negative';
}
