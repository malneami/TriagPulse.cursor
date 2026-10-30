/**
 * Pregnancy and postpartum — CTAS 2025 as written (approved by the clinical lead 2026-10-30).
 * Source: CTAS Guidelines 2025 (Hall et al., CJEM 2025;27:774–777) and its change table;
 * 2025 CTAS Quick Look Booklet (OB-GYN). BP uses SBP OR DBP (2025 change, aligned with SOGC).
 *
 * > 20 weeks (default 4): prolapsed cord / presenting parts, active bleeding, seizing/postictal,
 *   no fetal movement, penetrating abdominal trauma → 1; SBP > 160 or DBP > 100, pre-eclampsia
 *   symptoms (headache, oedema, epigastric pain, visual disturbance, CVA symptoms), decreased fetal
 *   movement, labour ≤ 5 min, major blunt trauma, unattended birth, high-risk substance use → 2;
 *   SBP > 140 or DBP > 90, labour > 5 min, fluid leak, bleeding before arrival, minor trauma,
 *   concern for welfare → 3.
 * < 20 weeks (default 5): penetrating abdominal trauma → 1; heavy bleeding, pelvic pressure with
 *   cramping/back pain → 2; mild–moderate bleeding, cramping, intractable vomiting, fluid leak,
 *   concern for welfare → 3; spotting → 4; discharge → 5.
 * Postpartum: SBP > 160 or DBP > 100 → 2; SBP > 140 or DBP > 90 → 3; active bleeding with clots,
 *   seizing/postictal → 1 (booklet lists these first).
 * Gestation not stated → ask; until answered the > 20-week findings apply (safer; local choice).
 */

export const PREGNANCY_RULES_META = { rule_set_id: 'pregnancy_ctas2025', version: '1.0.0', effective_date: '2026-10-30', approval_status: 'approved' };

const PREGNANT_RE = /\bpregnan\w*|\bgravida\b|\bG\d\s*P\d|\bgestation\w*|\bweeks? (?:pregnant|gestation)|حامل|حمل\b|الحمل|في\s*(?:ال)?شهر\s*\S+\s*(?:من\s*)?(?:ال)?حمل/i;
const POSTPARTUM_RE = /post-?partum|after (?:delivery|giving birth|birth)|(?:delivered|gave birth|had (?:a|her) baby|c-?section|caesarean|cesarean)\b[^.]{0,30}(?:ago|days?|weeks?|yesterday|last week)|نفاس|نفساء|بعد\s*(?:ال)?ولادة|ولدت\s*(?:قبل|من)/i;

const AR_MONTHS = { 'الأول': 1, 'الثاني': 2, 'الثالث': 3, 'الرابع': 4, 'الخامس': 5, 'السادس': 6, 'السابع': 7, 'الثامن': 8, 'التاسع': 9 };

/** Gestational age in weeks from the dictation, or null. */
export function gestationWeeks(text = '', answers = {}) {
  const a = String(answers.gestation_weeks ?? '').trim();
  if (a === 'under_20') return 12;
  if (a === 'over_20') return 30;
  if (/^\d{1,2}$/.test(a)) return Number(a);
  const t = String(text);
  let m = t.match(/(\d{1,2})(?:\+\d)?\s*(?:weeks?|wks?|w)\b\s*(?:pregnant|gestation|of pregnancy|GA|along)?/i);
  if (m && (PREGNANT_RE.test(t))) return Number(m[1]);
  m = t.match(/(?:GA|gestation(?:al age)?)\s*(?:of\s*)?(\d{1,2})/i);
  if (m) return Number(m[1]);
  m = t.match(/(?:الأسبوع|أسبوع)\s*(\d{1,2})|(\d{1,2})\s*(?:أسبوع|اسبوع)/);
  if (m && /حامل|حمل/.test(t)) return Number(m[1] || m[2]);
  m = t.match(/(?:ال)?شهر\s*(ال\S+)/);
  if (m && /حامل|حمل/.test(t)) {
    const mo = AR_MONTHS[m[1].replace(/^ال/, 'ال')] ?? AR_MONTHS[m[1]];
    if (mo) return Math.round(mo * 4.3);
  }
  m = t.match(/(\d)\s*(?:months?|أشهر|شهور)\s*(?:pregnant|حامل)/i);
  if (m) return Math.round(Number(m[1]) * 4.3);
  return null;
}

export const GESTATION_QUESTION = {
  id: 'gestation_weeks', field: 'gestation_weeks',
  text_ar: 'كم أسبوعاً عمر الحمل؟', text_en: 'How many weeks pregnant?',
  answer_type: 'options',
  options: [
    { value: 'under_20', label_ar: 'أقل من 20 أسبوعاً', label_en: 'Under 20 weeks' },
    { value: 'over_20', label_ar: '20 أسبوعاً فأكثر', label_en: '20 weeks or more' },
    { value: 'unknown', label_ar: 'غير متأكدة', label_en: 'Not sure' },
  ],
  question_category: 'ctas_modifier',
  reason_en: 'CTAS 2025 uses different pregnancy modifiers before and after 20 weeks.',
  reason_ar: 'معدّلات CTAS 2025 للحمل تختلف قبل 20 أسبوعاً وبعدها.',
};

const F = (level, id, en, ar, re) => ({ level, id, en, ar, re });
const OVER_20 = [
  F(1, 'cord', 'Presenting fetal parts or prolapsed cord', 'ظهور أجزاء الجنين أو تدلي الحبل السري', /prolaps\w* cord|cord prolapse|presenting (?:fetal )?part|(?:baby|head|foot|feet|hand) (?:is )?(?:out|visible|showing)|crowning|تدلي\s*(?:ال)?حبل|ظهور\s*(?:رأس|قدم|يد)\s*(?:ال)?(?:جنين|طفل)/i),
  F(1, 'active_bleed', 'Active vaginal bleeding', 'نزيف مهبلي نشط', /(?:active|heavy|ongoing|soaking|bright red|massive)\s+(?:vaginal\s+)?bleed\w*|bleeding (?:heavily|a lot|now)|haemorrhag\w*|hemorrhag\w*|نزيف\s*(?:مهبلي\s*)?(?:نشط|غزير|شديد|مستمر)/i),
  F(1, 'seizure', 'Actively seizing or postictal (eclampsia)', 'تشنج أو ما بعد التشنج', /seiz\w*|convuls\w*|fitting|post-?ictal|eclamp\w*|تشنج|تشنجات|صرع/i),
  F(1, 'no_fm', 'No fetal movement', 'لا توجد حركة للجنين', /no (?:fetal|foetal|baby)?\s*movements?|baby (?:is )?not moving|(?:hasn'?t|has not|not) (?:felt|moved)\b[^.]{0,20}(?:baby|move)|لا\s*(?:توجد\s*)?حركة\s*(?:لل)?جنين|الجنين\s*(?:ما|لا)\s*(?:يتحرك|يتحرك)|توقف\s*(?:حركة\s*)?(?:ال)?جنين/i),
  F(1, 'penetrating', 'Penetrating abdominal trauma', 'إصابة نافذة في البطن', /stab\w*|gunshot|penetrat\w*|طعن|طلق\s*ناري|إصابة\s*نافذة/i),
  F(2, 'preeclampsia', 'Headache / oedema / epigastric pain / visual disturbance / CVA symptoms (pre-eclampsia)', 'صداع / تورم / ألم فم المعدة / زغللة (تسمم حمل)', /headache|head pain|swelling (?:of )?(?:face|hands|legs|feet)|(?:facial|hand|leg) (?:swelling|oedema|edema)|oedema|edema|epigastric|right upper (?:quadrant|abdominal) pain|blurr\w* vision|visual (?:disturbance|change)|seeing (?:spots|flashes|stars)|flashing lights|pre-?eclamp\w*|slurred speech|facial droop|صداع|تورم\s*(?:في\s*)?(?:الوجه|اليدين|الرجلين|القدمين)|ألم\s*(?:في\s*)?فم\s*المعدة|زغللة|ضبابية\s*(?:في\s*)?(?:ال)?رؤية|تسمم\s*(?:ال)?حمل/i),
  F(2, 'decreased_fm', 'Decreased fetal movement', 'قلة حركة الجنين', /(?:decreas\w*|reduc\w*|less|fewer|weak)\s+(?:fetal |foetal |baby )?movements?|baby (?:is )?moving less|قلة\s*حركة\s*(?:ال)?جنين|حركة\s*(?:ال)?جنين\s*(?:قليلة|خفيفة|نقصت)/i),
  F(2, 'labour_close', 'Active labour (contractions ≤ 5 min apart)', 'ولادة نشطة (طلق كل ≤ 5 دقائق)', /contractions?\s*(?:every|q)\s*(?:[1-5]|one|two|three|four|five)\s*(?:-\s*\d\s*)?min|(?:[1-5])\s*min\w*\s*apart|طلق\s*كل\s*[1-5]\s*دقائق/i),
  F(2, 'major_trauma', 'Major blunt trauma', 'إصابة كليلة كبيرة', /(?:car|motor vehicle|road traffic)\s*(?:accident|crash|collision)|\bmvc\b|\brta\b|hit by (?:a )?car|fall from (?:height|stairs)|حادث\s*(?:سيارة|سير|مروري)|سقوط\s*من\s*(?:ال)?(?:درج|مرتفع)/i),
  F(2, 'unattended_birth', 'Unplanned or unattended birth', 'ولادة غير مخطط لها', /(?:gave birth|delivered|born)\s+(?:at home|in the car|on the way|unexpectedly|before arrival)|unattended birth|ولدت\s*(?:في\s*)?(?:البيت|السيارة|الطريق)/i),
  F(2, 'substance', 'High-risk substance use', 'تعاطي مواد عالية الخطورة', /\b(?:cocaine|heroin|opioid|methamphetamine|amphetamine|crystal meth|captagon)\b|كبتاجون|هيروين|كوكايين/i),
  F(3, 'labour_far', 'Active labour (contractions > 5 min apart)', 'ولادة (طلق كل > 5 دقائق)', /contractions?|labou?r pains?|in labou?r|طلق|آلام\s*(?:ال)?ولادة|مخاض/i),
  F(3, 'fluid_leak', 'Vaginal fluid leak (possible ruptured membranes)', 'نزول سائل (احتمال تمزق الأغشية)', /(?:water|waters) (?:broke|breaking|has broken)|fluid (?:leak\w*|loss)|leaking fluid|ruptur\w* (?:of )?membranes|\bsrom\b|\bprom\b|نزول\s*(?:ماء|سائل|مية)|نزل\s*(?:ال)?ماء|انفجار\s*(?:كيس\s*)?(?:ال)?ماء/i),
  F(3, 'bleed_before', 'History of bleeding before arrival', 'نزيف قبل الحضور', /bleed\w*|spotting|نزيف|نزول\s*دم|تنقيط/i),
  F(3, 'minor_trauma', 'Minor trauma, no direct abdominal trauma', 'إصابة بسيطة', /\bfell\b|\bfall\b|slipped|trip(?:ped)?|bump(?:ed)?|سقطت|انزلقت|تعثرت/i),
  F(3, 'welfare', 'Concern for patient welfare', 'قلق على سلامة المريضة', /domestic (?:violence|abuse)|unsafe at home|abuse|عنف\s*أسري|إساءة/i),
];
const UNDER_20 = [
  F(1, 'penetrating', 'Penetrating abdominal trauma', 'إصابة نافذة في البطن', OVER_20[4].re),
  F(2, 'heavy_bleed', 'Heavy vaginal bleeding', 'نزيف مهبلي غزير', /(?:heavy|massive|soaking|a lot of|large amount of)\s+(?:vaginal\s+)?bleed\w*|bleeding (?:heavily|a lot)|clots|haemorrhag\w*|hemorrhag\w*|نزيف\s*(?:غزير|شديد|كثير)|جلطات\s*دم/i),
  F(2, 'pelvic_pressure', 'Pelvic pressure with abdominal cramping, back pain', 'ضغط في الحوض مع مغص وألم ظهر', /pelvic pressure|pressure (?:in|down) (?:the )?pelvis|ضغط\s*(?:في\s*)?(?:ال)?حوض/i),
  F(3, 'mild_bleed', 'Mild to moderate vaginal bleeding', 'نزيف خفيف إلى متوسط', /bleed\w*|نزيف|نزول\s*دم/i),
  F(3, 'cramping', 'Cramping', 'مغص', /cramp\w*|abdominal pain|lower abdominal|pelvic pain|مغص|ألم\s*(?:أسفل\s*)?(?:ال)?بطن|ألم\s*(?:في\s*)?(?:ال)?حوض/i),
  F(3, 'hyperemesis', 'Intractable vomiting in pregnancy', 'قيء مستمر في الحمل', /(?:intractable|persistent|constant|non-?stop|severe)\s+vomit\w*|can'?t keep (?:anything|food|fluids) down|unable to keep (?:anything|food|fluids) down|hyperemesis|vomiting (?:all day|everything|non-?stop)|قيء\s*(?:مستمر|متكرر|شديد)|ترجيع\s*(?:مستمر|كل\s*شي)/i),
  F(3, 'fluid_leak', 'Possible vaginal fluid leak', 'احتمال نزول سائل', OVER_20[12].re),
  F(3, 'welfare', 'Concern for patient welfare', 'قلق على سلامة المريضة', OVER_20[15].re),
  F(4, 'spotting', 'Spotting', 'تنقيط', /spotting|تنقيط/i),
  F(5, 'discharge', 'Vaginal discharge', 'إفرازات مهبلية', /discharge|إفرازات/i),
];

const num = (v) => { const n = parseFloat(String(v ?? '').replace(',', '.')); return Number.isFinite(n) ? n : null; };
const NEG_RE = /\b(?:no|denies|without|not)\s+(?:\w+\s+){0,2}$/i;

function found(rule, text) {
  const re = new RegExp(rule.re.source, rule.re.flags.includes('g') ? rule.re.flags : `${rule.re.flags}g`);
  let m;
  while ((m = re.exec(text))) {
    const before = text.slice(Math.max(0, m.index - 25), m.index);
    if (!NEG_RE.test(before) && !/(?:لا\s*(?:يوجد|توجد)|بدون|ما\s*في)\s*$/.test(before)) return true;
    if (m[0].length === 0) re.lastIndex += 1;
  }
  return false;
}

/**
 * @returns {{ status: 'none'|'under_20'|'over_20'|'unknown_gestation'|'postpartum', weeks: number|null,
 *   candidates: Array<{level:number, rule_id:string, label_en:string, label_ar:string}>, needs_gestation: boolean }}
 */
export function evaluatePregnancy({ patient = {}, answers = {}, text = '' } = {}) {
  const out = { status: 'none', weeks: null, candidates: [], needs_gestation: false };
  const age = num(patient.age);
  if (age != null && (age < 10 || age > 60)) return out;
  if (/\b(?:male|boy|man|he|his)\b/i.test(String(patient.gender || '')) || String(patient.gender || '').toLowerCase() === 'male') return out;
  const t = String(text || '');
  const sbp = num(patient.bp_systolic ?? patient.sbp);
  const dbp = num(patient.bp_diastolic ?? patient.dbp);
  const postpartum = POSTPARTUM_RE.test(t) || String(answers.postpartum ?? '') === 'yes';
  const pregnant = PREGNANT_RE.test(t) || /^(نعم|yes|true)$/i.test(String(answers.pregnant ?? '').trim())
    || ['under_20', 'over_20', 'unknown'].includes(String(answers.gestation_weeks ?? ''));
  const hit = (level, id, en, ar) => out.candidates.push({ level, rule_id: `preg_${id}`, label_en: en, label_ar: ar });
  const bp = (prefix, prefixAr) => {
    if ((sbp != null && sbp > 160) || (dbp != null && dbp > 100)) hit(2, `${prefix}_bp_severe`, `${prefix === 'pp' ? 'Postpartum' : 'Pregnancy > 20 weeks'}: BP ${sbp ?? '—'}/${dbp ?? '—'} (SBP > 160 or DBP > 100) → CTAS 2`, `${prefixAr}: ضغط ${sbp ?? '—'}/${dbp ?? '—'} → CTAS 2`);
    else if ((sbp != null && sbp > 140) || (dbp != null && dbp > 90)) hit(3, `${prefix}_bp`, `${prefix === 'pp' ? 'Postpartum' : 'Pregnancy > 20 weeks'}: BP ${sbp ?? '—'}/${dbp ?? '—'} (SBP > 140 or DBP > 90) → CTAS 3`, `${prefixAr}: ضغط ${sbp ?? '—'}/${dbp ?? '—'} → CTAS 3`);
  };

  if (postpartum && !pregnant) {
    out.status = 'postpartum';
    bp('pp', 'بعد الولادة');
    if (/(?:active|heavy)\s+bleed\w*|bleeding with clots|clots|soaking|نزيف\s*(?:غزير|نشط)|جلطات/i.test(t)) hit(1, 'pp_bleed', 'Postpartum: active bleeding with clots → CTAS 1', 'بعد الولادة: نزيف نشط مع جلطات → CTAS 1');
    if (found(OVER_20[2], t)) hit(1, 'pp_seizure', 'Postpartum: seizing or postictal → CTAS 1', 'بعد الولادة: تشنج → CTAS 1');
    if (found(OVER_20[5], t)) hit(2, 'pp_preeclampsia', 'Postpartum: headache / visual disturbance / epigastric pain (pre-eclampsia) → CTAS 2', 'بعد الولادة: أعراض تسمم حمل → CTAS 2');
    return out;
  }
  if (!pregnant) return out;

  const weeks = gestationWeeks(t, answers);
  out.weeks = weeks;
  const ans = String(answers.gestation_weeks ?? '');
  const over = weeks != null ? weeks >= 20 : true; // unknown → > 20-week findings (safer)
  out.status = weeks != null ? (weeks >= 20 ? 'over_20' : 'under_20') : 'unknown_gestation';
  out.needs_gestation = weeks == null && ans !== 'unknown';
  const label = weeks != null ? `${weeks} weeks` : 'gestation not stated';
  // Most urgent finding per table; a lower-level finding is skipped once a more urgent one of the
  // same kind has matched (e.g. «active bleeding» → 1 rather than «bleeding before arrival» → 3).
  const table = over ? OVER_20 : UNDER_20;
  const seenKinds = new Set();
  const kind = (id) => (/bleed|spotting/.test(id) ? 'bleed' : /labour/.test(id) ? 'labour' : /trauma|penetrating/.test(id) ? 'trauma' : id);
  for (const r of table) {
    if (seenKinds.has(kind(r.id))) continue;
    if (found(r, t)) {
      seenKinds.add(kind(r.id));
      hit(r.level, `${over ? 'gt20' : 'lt20'}_${r.id}`, `Pregnancy (${label}): ${r.en} → CTAS ${r.level}`, `حمل (${weeks != null ? `${weeks} أسبوع` : 'عمر غير محدد'}): ${r.ar} → CTAS ${r.level}`);
    }
  }
  if (over) bp('gt20', 'حمل > 20 أسبوع');
  return out;
}
