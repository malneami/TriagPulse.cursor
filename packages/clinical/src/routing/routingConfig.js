/**
 * Patient direction (ED zone) — configurable per department.
 *
 * Two layers:
 *  1. CTAS core (international, the same for every facility, not editable):
 *     - CTAS 1–2 and life-threat findings go to the department's resuscitation zone;
 *     - respiratory isolation from visual triage holds the patient in the isolation zone;
 *     - a zone is never chosen for a CTAS level it does not accept.
 *  2. Center configuration (edited by the admin, versioned):
 *     - zones: names, which CTAS levels they take by default / can receive, ages,
 *       closed hours, busy switch, overflow zone;
 *     - direction rules: IF age + CTAS + complaint + answer + time THEN zone, in order.
 *
 * Rules are data only (no code, no regular expressions), so a configuration can never
 * break the app; validateRoutingConfig() checks it before it is published.
 */

export const ROUTING_ENGINE_VERSION = '1.0.0';

const YES_RE = /^(نعم|yes|true|1)$/i;
const isYes = (v) => YES_RE.test(String(v ?? '').trim());

const ALL_LEVELS = [1, 2, 3, 4, 5];

/** Zone kinds the core understands. */
export const ZONE_KINDS = ['resus', 'observation', 'clinic', 'fast_track', 'respiratory', 'other'];

/**
 * Built-in configuration: reproduces HMG's current routing. It is only a starting
 * template — every facility can replace it from the admin page.
 */
export const DEFAULT_ROUTING_CONFIG = {
  version: 'builtin-1',
  facility: { code: 'default', name_ar: 'المنشأة', name_en: 'Facility', timezone: 'Asia/Riyadh' },
  departments: [
    {
      code: 'PED',
      name_ar: 'طوارئ الأطفال',
      name_en: 'Paediatric ED',
      age_min: 0,
      age_max: 14, // exclusive: under 14 years
      zones: [
        { code: 'PEDIATRIC_RESUS', kind: 'resus', name_ar: 'إنعاش الأطفال', name_en: 'Pediatric Resuscitation', color: '#E24B4A', default_levels: [1, 2], accepts_levels: ALL_LEVELS, closed_hours: [], overflow_to: null, active: true },
        { code: 'PEDIATRIC_OBSERVATION', kind: 'observation', name_ar: 'ملاحظة الأطفال', name_en: 'Pediatric Observation', color: '#0F6E56', default_levels: [3], accepts_levels: ALL_LEVELS, closed_hours: [], overflow_to: null, active: true },
        { code: 'PEDIATRIC_CLINIC', kind: 'clinic', name_ar: 'عيادة الأطفال', name_en: 'Pediatric Clinic', color: '#888780', default_levels: [4, 5], accepts_levels: [4, 5], closed_hours: [], overflow_to: 'PEDIATRIC_OBSERVATION', active: true },
        { code: 'PEDS_FAST_TRACK', kind: 'fast_track', name_ar: 'المسار السريع', name_en: 'Fast Track', color: '#378ADD', default_levels: [], accepts_levels: [4, 5], closed_hours: [{ from: '06:00', to: '14:00' }], overflow_to: 'PEDIATRIC_OBSERVATION', active: true },
        { code: 'RESPIRATORY', kind: 'respiratory', name_ar: 'المنطقة التنفسية', name_en: 'Respiratory Area', color: '#9F4EBB', default_levels: [], accepts_levels: [3, 4, 5], closed_hours: [], overflow_to: null, active: true },
      ],
      rules: [
        { id: 'ped_wound', active: true, name_ar: 'جرح', name_en: 'Wound', when: { levels: [4, 5], complaints: ['laceration', 'puncture', 'abrasion'], keywords: ['wound', 'laceration', 'cut', 'جرح', 'جروح', 'تمزق'] }, zone: 'PEDIATRIC_OBSERVATION', reason_ar: 'دليل توجيه الأطفال: جرح → الملاحظة', reason_en: 'Routing guide: wound → Observation' },
        { id: 'ped_bleeding', active: true, name_ar: 'نزيف', name_en: 'Bleeding', when: { levels: [4, 5], complaints: ['epistaxis', 'vaginal_bleed', 'vaginal_bleeding', 'blood_in_stools', 'active_bleeding', 'gi_bleed'], keywords: ['bleed', 'bleeding', 'nosebleed', 'نزيف', 'ينزف', 'رعاف'] }, zone: 'PEDIATRIC_OBSERVATION', reason_ar: 'دليل توجيه الأطفال: نزيف → الملاحظة', reason_en: 'Routing guide: bleeding → Observation' },
        { id: 'ped_procedure', active: true, name_ar: 'يحتاج إجراء', name_en: 'Needs a procedure', when: { answers: [{ field: 'minor_procedure', value: 'yes' }] }, zone: 'PEDIATRIC_OBSERVATION', reason_ar: 'كل الإجراءات في الملاحظة', reason_en: 'All procedures in Observation' },
        { id: 'ped_return_visit', active: true, name_ar: 'مراجعة خلال ٧٢ ساعة', name_en: 'Return visit within 72 h', when: { answers: [{ field: 'return_visit_72h', value: 'yes' }] }, zone: 'PEDIATRIC_OBSERVATION', reason_ar: 'مراجعة خلال ٧٢ ساعة → الملاحظة', reason_en: 'Return visit within 72 h → Observation' },
        { id: 'ped_recent_surgery', active: true, name_ar: 'عملية حديثة', name_en: 'Recent surgery', when: { answers: [{ field: 'recent_abdominal_surgery', value: 'yes' }] }, zone: 'PEDIATRIC_OBSERVATION', reason_ar: 'عملية حديثة → الملاحظة', reason_en: 'Recent surgery → Observation' },
      ],
    },
    {
      code: 'ADULT',
      name_ar: 'طوارئ البالغين',
      name_en: 'Adult ED',
      age_min: 14,
      age_max: null,
      zones: [
        { code: 'RESUSCITATION', kind: 'resus', name_ar: 'منطقة الإنعاش', name_en: 'Resuscitation Area', color: '#E24B4A', default_levels: [1, 2], accepts_levels: ALL_LEVELS, closed_hours: [], overflow_to: null, active: true },
        { code: 'ADULT_OBSERVATION', kind: 'observation', name_ar: 'منطقة الملاحظة', name_en: 'Observation Area', color: '#0F6E56', default_levels: [3], accepts_levels: ALL_LEVELS, closed_hours: [], overflow_to: null, active: true },
        { code: 'FM_IM', kind: 'clinic', name_ar: 'طب الأسرة والباطنة', name_en: 'Family Medicine & Internal Medicine', color: '#378ADD', default_levels: [4, 5], accepts_levels: [4, 5], closed_hours: [], overflow_to: 'ADULT_OBSERVATION', active: true },
        { code: 'RESPIRATORY', kind: 'respiratory', name_ar: 'المنطقة التنفسية', name_en: 'Respiratory Area', color: '#9F4EBB', default_levels: [], accepts_levels: [3, 4, 5], closed_hours: [], overflow_to: null, active: true },
      ],
      rules: [
        { id: 'adult_return_visit', active: true, name_ar: 'مراجعة خلال ٧٢ ساعة', name_en: 'Return visit within 72 h', when: { answers: [{ field: 'return_visit_72h', value: 'yes' }] }, zone: 'ADULT_OBSERVATION', reason_ar: 'مراجعة خلال ٧٢ ساعة → الملاحظة', reason_en: 'Return visit within 72 h → Observation' },
        { id: 'adult_recent_surgery', active: true, name_ar: 'عملية حديثة', name_en: 'Recent surgery', when: { answers: [{ field: 'recent_abdominal_surgery', value: 'yes' }] }, zone: 'ADULT_OBSERVATION', reason_ar: 'عملية حديثة → الملاحظة', reason_en: 'Recent surgery → Observation' },
        { id: 'adult_pregnancy', active: true, name_ar: 'حمل محتمل', name_en: 'Possible pregnancy', when: { answers: [{ field: 'possible_pregnancy', value: 'yes' }] }, zone: 'ADULT_OBSERVATION', reason_ar: 'حمل محتمل → الملاحظة', reason_en: 'Possible pregnancy → Observation' },
      ],
    },
  ],
};

// ── Runtime state: the active configuration and live zone status ─────────────
let activeConfig = DEFAULT_ROUTING_CONFIG;
let zoneStatus = {}; // { [deptCode]: { [zoneCode]: { busy: boolean } } }

export function setActiveRoutingConfig(config) {
  activeConfig = config && Array.isArray(config.departments) ? config : DEFAULT_ROUTING_CONFIG;
}
export function getActiveRoutingConfig() { return activeConfig; }
export function resetRoutingConfigToBuiltin() { activeConfig = DEFAULT_ROUTING_CONFIG; }
export function setZoneStatus(status) { zoneStatus = status && typeof status === 'object' ? status : {}; }
export function getZoneStatus() { return zoneStatus; }

// ── Helpers ──────────────────────────────────────────────────────────────────
function toNum(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

/** Department for an age: the one whose range contains it; unknown age → the adult one. */
export function departmentFor(config, age) {
  const depts = (config?.departments || []);
  const a = toNum(age);
  if (a != null) {
    const hit = depts.find((d) => (d.age_min == null || a >= d.age_min) && (d.age_max == null || a < d.age_max));
    if (hit) return hit;
  }
  return depts.find((d) => d.age_max == null) || depts[depts.length - 1] || null;
}

function minutesOf(hhmm) {
  const m = String(hhmm || '').match(/^(\d{1,2}):(\d{2})$/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** Local minutes since midnight in the facility time zone. */
export function localMinutes(now = new Date(), timeZone = 'Asia/Riyadh') {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(now);
    const h = Number(parts.find((p) => p.type === 'hour')?.value) % 24;
    const m = Number(parts.find((p) => p.type === 'minute')?.value);
    return h * 60 + m;
  } catch {
    return now.getHours() * 60 + now.getMinutes();
  }
}

/** Inside [from, to) — windows may cross midnight (22:00–06:00). */
function inWindow(mins, from, to) {
  const f = minutesOf(from);
  const t = minutesOf(to);
  if (f == null || t == null || f === t) return false;
  return f < t ? mins >= f && mins < t : mins >= f || mins < t;
}

function zoneClosed(zone, mins) {
  return (zone.closed_hours || []).some((w) => inWindow(mins, w.from, w.to));
}

function zoneBusy(dept, zone) {
  return !!zoneStatus?.[dept.code]?.[zone.code]?.busy;
}

const norm = (s) => String(s || '').toLowerCase().normalize('NFKC');

/** Whether one rule's conditions all hold (lists are "any of"). */
export function ruleMatches(rule, ctx) {
  const w = rule.when || {};
  if (w.age_min != null && (ctx.age == null || ctx.age < w.age_min)) return false;
  if (w.age_max != null && (ctx.age == null || ctx.age >= w.age_max)) return false;
  if (Array.isArray(w.levels) && w.levels.length && !w.levels.includes(ctx.level)) return false;
  const hasComplaintCond = (w.complaints?.length || 0) + (w.keywords?.length || 0) > 0;
  if (hasComplaintCond) {
    const keys = new Set(ctx.complaints.map((c) => c?.key).filter(Boolean));
    const text = norm(ctx.complaints.map((c) => [c?.text, c?.label_en, c?.label_ar].filter(Boolean).join(' ')).join(' | '));
    const byKey = (w.complaints || []).some((k) => keys.has(k));
    const byWord = (w.keywords || []).some((kw) => {
      const k = norm(kw).trim();
      if (!k) return false;
      // Whole word for short Latin words ("cut" not inside "acute").
      return /^[a-z]{1,4}$/.test(k) ? new RegExp(`\\b${k}\\b`).test(text) : text.includes(k);
    });
    if (!byKey && !byWord) return false;
  }
  for (const a of w.answers || []) {
    const v = ctx.answers?.[a.field];
    const want = String(a.value ?? 'yes').toLowerCase();
    const ok = want === 'yes' ? isYes(v) : String(v ?? '').toLowerCase() === want;
    if (!ok) return false;
  }
  if (w.time && (w.time.from || w.time.to) && !inWindow(ctx.minutes, w.time.from, w.time.to)) return false;
  return true;
}

function zoneView(dept, zone, extra = {}) {
  return {
    destination: zone.code,
    destination_ar: zone.name_ar,
    destination_en: zone.name_en,
    color: zone.color || '#888780',
    kind: zone.kind,
    department: dept.code,
    ...extra,
  };
}

/**
 * Follow overflow while the zone is closed or busy (and the next zone accepts the level).
 * Returns the final zone and why it moved.
 */
function applyAvailability(dept, zone, level, mins) {
  const byCode = new Map(dept.zones.map((z) => [z.code, z]));
  let cur = zone;
  const hops = [];
  for (let i = 0; i < 6; i += 1) {
    const closed = zoneClosed(cur, mins);
    const busy = zoneBusy(dept, cur);
    if (!closed && !busy) break;
    const next = cur.overflow_to ? byCode.get(cur.overflow_to) : null;
    if (!next || next.active === false || !(next.accepts_levels || []).includes(level) || hops.some((h) => h.to === next.code)) {
      hops.push({ from: cur.code, to: null, why: closed ? 'closed' : 'busy' });
      break;
    }
    hops.push({ from: cur.code, from_ar: cur.name_ar, from_en: cur.name_en, to: next.code, why: closed ? 'closed' : 'busy' });
    cur = next;
  }
  return { zone: cur, hops };
}

/**
 * Resolve the patient's zone.
 * @param {object} opts
 * @param {number} opts.level           CTAS level shown
 * @param {number|string} opts.age
 * @param {object} [opts.answers]       clarifying answers
 * @param {Array}  [opts.complaints]    [{key, text, label_en, label_ar}]
 * @param {string|object|null} [opts.visualDestination]  'RESPIRATORY' isolation from visual triage
 * @param {Array}  [opts.applied]       modifier rows (life-threat hints)
 * @param {Array}  [opts.directionApplied]
 * @param {Date}   [opts.now]
 * @param {object} [opts.config]        defaults to the active configuration
 */
export function resolveDirection({
  level, age, answers = {}, complaints = [], visualDestination = null,
  applied = [], directionApplied = [], now = new Date(), config = null,
} = {}) {
  const cfg = config || activeConfig;
  const lvl = Number(level) || 5;
  const dept = departmentFor(cfg, age);
  if (!dept) return null;
  const zones = (dept.zones || []).filter((z) => z.active !== false);
  const mins = localMinutes(now, cfg.facility?.timezone || 'Asia/Riyadh');
  const accepts = (z) => (z.accepts_levels || []).includes(lvl);
  const resus = zones.find((z) => z.kind === 'resus');

  // ── Core (international) ──
  const lifeThreat = [...(directionApplied || []), ...(applied || [])]
    .some((a) => a?.destination_hint === 'RESUSCITATION' || a?.destination_hint === 'PEDIATRIC_RESUS');
  if (resus && (lvl <= 2 || lifeThreat)) {
    return zoneView(dept, resus, lifeThreat && lvl > 2 ? { from_direction_rule: true, reason_ar: 'علامة خطر → الإنعاش', reason_en: 'Life-threat finding → Resuscitation' } : {});
  }
  const visualCode = typeof visualDestination === 'string' ? visualDestination
    : (visualDestination?.destination || visualDestination?.vt_destination || null);
  if (visualCode === 'RESPIRATORY') {
    const iso = zones.find((z) => z.kind === 'respiratory');
    if (iso) return zoneView(dept, iso, { from_isolation_hold: true });
  }

  // ── Center rules, in order ──
  const ctx = { level: lvl, age: toNum(age), answers, complaints: complaints || [], minutes: mins };
  for (const rule of dept.rules || []) {
    if (rule.active === false || !ruleMatches(rule, ctx)) continue;
    const target = zones.find((z) => z.code === rule.zone);
    // Core: never send a patient to a zone that does not take this CTAS level.
    if (!target || !accepts(target)) continue;
    const { zone, hops } = applyAvailability(dept, target, lvl, mins);
    return zoneView(dept, zone, {
      from_routing_rule: { id: rule.id, name_ar: rule.name_ar, name_en: rule.name_en },
      reason_ar: rule.reason_ar, reason_en: rule.reason_en,
      overflow: hops.length ? hops : undefined,
    });
  }

  // ── Default zone for the level ──
  const def = zones.find((z) => (z.default_levels || []).includes(lvl) && accepts(z))
    || zones.find((z) => accepts(z));
  if (!def) return null;
  const { zone, hops } = applyAvailability(dept, def, lvl, mins);
  return zoneView(dept, zone, { overflow: hops.length ? hops : undefined });
}

/** Human-readable overflow note: «المسار السريع (خارج وقت العمل) → ملاحظة الأطفال». */
export function overflowNote(direction) {
  const h = (direction?.overflow || []).filter((x) => x.to);
  if (!h.length) return null;
  const last = h[h.length - 1];
  const first = h[0];
  const whyAr = first.why === 'closed' ? 'خارج وقت العمل' : 'ازدحام';
  const whyEn = first.why === 'closed' ? 'closed' : 'busy';
  return {
    ar: `${first.from_ar || first.from} (${whyAr}) → ${direction.destination_ar}`,
    en: `${first.from_en || first.from} ${whyEn} → ${direction.destination_en}`,
    to: last.to,
  };
}

/**
 * Check a configuration before it is published. Returns a list of problems
 * (empty = valid). Errors block publishing; the core rules hold whatever the config.
 */
export function validateRoutingConfig(config) {
  const errors = [];
  const add = (msg_ar, msg_en, where = '') => errors.push({ ar: msg_ar, en: msg_en, where });
  if (!config || !Array.isArray(config.departments) || !config.departments.length) {
    add('لا توجد أقسام', 'No departments', 'departments');
    return errors;
  }
  const deptCodes = new Set();
  for (const d of config.departments) {
    const w = d.code || '?';
    if (!d.code) add('قسم بدون رمز', 'Department without a code', w);
    if (deptCodes.has(d.code)) add('رمز قسم مكرر', 'Duplicate department code', w);
    deptCodes.add(d.code);
    if (!d.name_ar || !d.name_en) add('اسم القسم مطلوب بالعربية والإنجليزية', 'Department name needed in Arabic and English', w);
    const zones = d.zones || [];
    const codes = new Set();
    for (const z of zones) {
      const zw = `${w}/${z.code || '?'}`;
      if (!z.code) add('منطقة بدون رمز', 'Zone without a code', zw);
      if (codes.has(z.code)) add('رمز منطقة مكرر', 'Duplicate zone code', zw);
      codes.add(z.code);
      if (!z.name_ar || !z.name_en) add('اسم المنطقة مطلوب بالعربية والإنجليزية', 'Zone name needed in Arabic and English', zw);
      if (!ZONE_KINDS.includes(z.kind)) add('نوع المنطقة غير صحيح', 'Unknown zone kind', zw);
      for (const l of z.default_levels || []) {
        if (!(z.accepts_levels || []).includes(l)) add(`المستوى ${l} افتراضي لكنه غير مقبول في المنطقة`, `CTAS ${l} is a default but not accepted by the zone`, zw);
      }
      for (const win of z.closed_hours || []) {
        if (minutesOf(win.from) == null || minutesOf(win.to) == null) add('وقت الإغلاق يجب أن يكون بصيغة HH:MM', 'Closed hours must be HH:MM', zw);
      }
      if (z.overflow_to && !zones.some((o) => o.code === z.overflow_to)) add('منطقة التحويل غير موجودة', 'Overflow zone does not exist', zw);
      if (z.overflow_to === z.code) add('لا يمكن تحويل المنطقة إلى نفسها', 'A zone cannot overflow to itself', zw);
    }
    const active = zones.filter((z) => z.active !== false);
    if (!active.some((z) => z.kind === 'resus')) add('يجب وجود منطقة إنعاش فعّالة', 'An active resuscitation zone is required', w);
    for (const l of ALL_LEVELS) {
      if (!active.some((z) => (z.default_levels || []).includes(l))) add(`لا توجد منطقة افتراضية لـ CTAS ${l}`, `No default zone for CTAS ${l}`, w);
    }
    // Overflow loops.
    for (const z of active) {
      const seen = new Set([z.code]);
      let cur = z;
      while (cur?.overflow_to) {
        if (seen.has(cur.overflow_to)) { add('حلقة في التحويل بين المناطق', 'Overflow loop between zones', `${w}/${z.code}`); break; }
        seen.add(cur.overflow_to);
        cur = active.find((o) => o.code === cur.overflow_to);
      }
    }
    const ids = new Set();
    for (const r of d.rules || []) {
      const rw = `${w}/rule:${r.id || '?'}`;
      if (!r.id) add('قاعدة بدون معرّف', 'Rule without an id', rw);
      if (ids.has(r.id)) add('معرّف قاعدة مكرر', 'Duplicate rule id', rw);
      ids.add(r.id);
      if (!zones.some((z) => z.code === r.zone)) add('منطقة القاعدة غير موجودة', 'Rule zone does not exist', rw);
      if (!r.reason_ar || !r.reason_en) add('سبب القاعدة مطلوب بالعربية والإنجليزية', 'Rule reason needed in Arabic and English', rw);
      const wh = r.when || {};
      const empty = !(wh.levels?.length || wh.complaints?.length || wh.keywords?.length || wh.answers?.length || wh.time || wh.age_min != null || wh.age_max != null);
      if (empty) add('القاعدة بدون شروط ستنطبق على كل المرضى', 'A rule with no conditions would match every patient', rw);
      if (wh.time && (minutesOf(wh.time.from) == null || minutesOf(wh.time.to) == null)) add('وقت القاعدة يجب أن يكون بصيغة HH:MM', 'Rule time must be HH:MM', rw);
      const target = zones.find((z) => z.code === r.zone);
      if (target && wh.levels?.length && wh.levels.every((l) => !(target.accepts_levels || []).includes(l))) {
        add('المنطقة لا تستقبل أي مستوى من مستويات القاعدة', 'The zone takes none of the rule\'s CTAS levels', rw);
      }
    }
  }
  return errors;
}
