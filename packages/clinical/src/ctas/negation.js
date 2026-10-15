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
