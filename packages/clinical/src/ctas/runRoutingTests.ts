/**
 * Configurable routing: zones (levels, hours, busy, overflow) and direction rules.
 */
import {
  DEFAULT_ROUTING_CONFIG,
  resolveDirection,
  validateRoutingConfig,
  setZoneStatus,
} from '../routing/routingConfig.js';

type Assert = (cond: boolean, id: string, name: string, detail?: string) => void;

/** A Date at a given Riyadh local time (UTC+3). */
const riyadh = (hh: number, mm = 0) => new Date(Date.UTC(2026, 9, 16, hh - 3, mm));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const clone = (x: unknown): any => JSON.parse(JSON.stringify(x));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const resolve = resolveDirection as (opts: any) => any;

export function runRoutingTests(assert: Assert) {
  const d = (opts: Record<string, unknown>) => (resolve(opts) as { destination: string } | null)?.destination;

  assert(validateRoutingConfig(DEFAULT_ROUTING_CONFIG).length === 0, 'RT-01', 'the built-in configuration is valid',
    JSON.stringify(validateRoutingConfig(DEFAULT_ROUTING_CONFIG)));

  // Fast Track closed 06:00–14:00 → overflow to Observation.
  {
    const cfg = clone(DEFAULT_ROUTING_CONFIG);
    const ped = cfg.departments.find((x: { code: string }) => x.code === 'PED');
    ped.rules.unshift({ id: 'ft_bite', when: { levels: [4, 5], keywords: ['bite', 'عضة'] }, zone: 'PEDS_FAST_TRACK', reason_ar: 'عضة → المسار السريع', reason_en: 'Bite → Fast Track' });
    const bite = [{ key: null, text: 'dog bite on hand' }];
    const at10 = resolve({ level: 4, age: 7, complaints: bite, now: riyadh(10), config: cfg }) as { destination: string; overflow?: unknown[] };
    const at16 = d({ level: 4, age: 7, complaints: bite, now: riyadh(16), config: cfg });
    assert(at10.destination === 'PEDIATRIC_OBSERVATION' && !!at10.overflow && at16 === 'PEDS_FAST_TRACK', 'RT-02',
      'a rule to Fast Track goes to Observation while Fast Track is closed (10:00) and to Fast Track at 16:00', JSON.stringify([at10.destination, at16]));
    // A Fast Track rule never takes a CTAS 3 patient (core: zone must accept the level).
    assert(d({ level: 3, age: 7, complaints: bite, now: riyadh(16), config: cfg }) === 'PEDIATRIC_OBSERVATION', 'RT-03',
      'a rule cannot send CTAS 3 to a zone that takes only 4–5');
  }

  // Busy switch → overflow.
  {
    setZoneStatus({ PED: { PEDIATRIC_CLINIC: { busy: true } } });
    const busy = d({ level: 5, age: 6 });
    setZoneStatus({});
    const free = d({ level: 5, age: 6 });
    assert(busy === 'PEDIATRIC_OBSERVATION' && free === 'PEDIATRIC_CLINIC', 'RT-04', 'Clinic busy → Observation; not busy → Clinic', JSON.stringify([busy, free]));
  }

  // Rule order, time window, answers, whole-word keywords; core always first.
  {
    const cfg = clone(DEFAULT_ROUTING_CONFIG);
    const adult = cfg.departments.find((x: { code: string }) => x.code === 'ADULT');
    adult.rules = [
      { id: 'night_clinic', when: { levels: [4, 5], time: { from: '22:00', to: '06:00' } }, zone: 'ADULT_OBSERVATION', reason_ar: 'ليلاً → الملاحظة', reason_en: 'Night → Observation' },
      { id: 'cut', when: { keywords: ['cut'] }, zone: 'ADULT_OBSERVATION', reason_ar: 'جرح', reason_en: 'Cut' },
    ];
    const night = d({ level: 5, age: 40, now: riyadh(23), config: cfg });
    const day = d({ level: 5, age: 40, now: riyadh(12), config: cfg });
    const acute = d({ level: 5, age: 40, now: riyadh(12), complaints: [{ text: 'acute abdominal pain' }], config: cfg });
    const resus = d({ level: 2, age: 40, now: riyadh(23), config: cfg });
    assert(night === 'ADULT_OBSERVATION' && day === 'FM_IM' && acute === 'FM_IM' && resus === 'RESUSCITATION', 'RT-05',
      'time window across midnight; "cut" not matched inside "acute"; CTAS 2 always Resus whatever the rules', JSON.stringify([night, day, acute, resus]));
  }

  // Validation catches unsafe configurations.
  {
    const cfg = clone(DEFAULT_ROUTING_CONFIG);
    const ped = cfg.departments.find((x: { code: string }) => x.code === 'PED');
    ped.zones = ped.zones.filter((z: { kind: string }) => z.kind !== 'resus');
    ped.zones.find((z: { code: string }) => z.code === 'PEDIATRIC_CLINIC').overflow_to = 'PEDS_FAST_TRACK';
    ped.zones.find((z: { code: string }) => z.code === 'PEDS_FAST_TRACK').overflow_to = 'PEDIATRIC_CLINIC';
    ped.rules.push({ id: 'everyone', when: {}, zone: 'PEDIATRIC_CLINIC', reason_ar: 'x', reason_en: 'x' });
    const errs = validateRoutingConfig(cfg).map((e: { en: string }) => e.en).join(' | ');
    assert(/resuscitation zone is required/.test(errs) && /No default zone for CTAS 1/.test(errs)
      && /Overflow loop/.test(errs) && /no conditions/.test(errs), 'RT-06',
      'validation: missing resus zone, CTAS level without a zone, overflow loop, rule with no conditions', errs);
  }
}
