import type {
  ClinicalLibraryBundle,
  LibraryVersionsSnapshot,
  RedFlagLibrary,
  SerializableModifier,
} from './types';
import { buildDefaultRedFlagLibrary, RED_FLAG_LIBRARY_VERSION } from './redFlagLibrary';

export type RuntimeModifier = Omit<SerializableModifier, 'detect_patterns' | 'related_medications'> & {
  detect_patterns: RegExp[];
  related_medications?: RegExp[];
};

type RuntimeState = {
  source: 'builtin' | 'published';
  bundleVersion: string;
  publishedAt: string | null;
  publishedBy: string | null;
  modifiers: RuntimeModifier[] | null;
  modifiersVersion: string;
  redFlags: RedFlagLibrary;
};

let state: RuntimeState = {
  source: 'builtin',
  bundleVersion: 'builtin',
  publishedAt: null,
  publishedBy: null,
  modifiers: null,
  modifiersVersion: '1.0.0',
  redFlags: buildDefaultRedFlagLibrary(),
};

function toRegExp(pattern: string | RegExp): RegExp {
  if (pattern instanceof RegExp) return pattern;
  try {
    return new RegExp(pattern, 'i');
  } catch {
    return new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  }
}

/** Hydrate serializable modifiers into runtime RegExp form. */
export function hydrateModifiers(list: SerializableModifier[]): RuntimeModifier[] {
  return list.map((m) => ({
    ...m,
    detect_patterns: (m.detect_patterns || []).map(toRegExp),
    related_medications: (m.related_medications || []).map(toRegExp),
  }));
}

/** Serialize runtime/builtin modifiers (RegExp → string source). */
export function serializeModifier(mod: {
  id: string;
  name: string;
  name_ar: string;
  pathways: string[];
  age_applicability: string;
  field: string;
  detect_patterns?: Array<string | RegExp>;
  related_medications?: Array<string | RegExp>;
  question_ar: string;
  question_en: string;
  answer_type: string;
  options: SerializableModifier['options'];
  ctas_effect_yes?: number | null;
  destination_effect?: string | null;
  critical_alert?: boolean;
  team_leader_review?: boolean;
  question_category?: string;
  shown_when_ctas?: number[];
  clinical_explanation_ar: string;
  clinical_explanation_en: string;
  priority: number;
  active: boolean;
  protocol_source: string;
  version: string;
  review_date: string;
}): SerializableModifier {
  return {
    id: mod.id,
    name: mod.name,
    name_ar: mod.name_ar,
    pathways: [...(mod.pathways || [])],
    age_applicability: (mod.age_applicability as SerializableModifier['age_applicability']) || 'both',
    field: mod.field,
    detect_patterns: (mod.detect_patterns || []).map((p) => (p instanceof RegExp ? p.source : String(p))),
    related_medications: (mod.related_medications || []).map((p) => (p instanceof RegExp ? p.source : String(p))),
    question_ar: mod.question_ar,
    question_en: mod.question_en,
    answer_type: mod.answer_type as SerializableModifier['answer_type'],
    options: (mod.options || []).map((o) => ({ ...o })),
    ctas_effect_yes: mod.ctas_effect_yes ?? null,
    destination_effect: mod.destination_effect ?? null,
    critical_alert: !!mod.critical_alert,
    team_leader_review: !!mod.team_leader_review,
    question_category: mod.question_category as SerializableModifier['question_category'],
    shown_when_ctas: Array.isArray(mod.shown_when_ctas) ? [...mod.shown_when_ctas] : undefined,
    clinical_explanation_ar: mod.clinical_explanation_ar,
    clinical_explanation_en: mod.clinical_explanation_en,
    priority: mod.priority,
    active: mod.active !== false,
    protocol_source: mod.protocol_source,
    version: mod.version,
    review_date: mod.review_date,
  };
}

export function getRedFlagLibrary(): RedFlagLibrary {
  return state.redFlags;
}

export function getRuntimeModifiers(): RuntimeModifier[] | null {
  return state.modifiers;
}

export function getLibraryVersions(): LibraryVersionsSnapshot {
  return {
    bundle: state.bundleVersion,
    modifiers: state.modifiersVersion,
    red_flags: state.redFlags.version || RED_FLAG_LIBRARY_VERSION,
    source: state.source,
    published_at: state.publishedAt,
  };
}

export function resetClinicalLibrariesToBuiltin(builtinModifierVersion = '1.0.0') {
  state = {
    source: 'builtin',
    bundleVersion: 'builtin',
    publishedAt: null,
    publishedBy: null,
    modifiers: null,
    modifiersVersion: builtinModifierVersion,
    redFlags: buildDefaultRedFlagLibrary(),
  };
}

/**
 * Apply a published clinical library bundle (from admin / DB).
 * Pass modifiers: null to keep using builtin modifier array.
 */
export function applyClinicalLibraryBundle(bundle: {
  version: string;
  modifiers?: SerializableModifier[] | null;
  modifiers_version?: string;
  red_flags?: RedFlagLibrary | null;
  published_at?: string | null;
  published_by?: string | null;
}) {
  const redFlags = bundle.red_flags
    ? {
        version: bundle.red_flags.version || RED_FLAG_LIBRARY_VERSION,
        thresholds: { ...bundle.red_flags.thresholds },
        text_rules: (bundle.red_flags.text_rules || []).map((r) => ({
          ...r,
          terms: [...(r.terms || [])],
        })),
      }
    : buildDefaultRedFlagLibrary();

  state = {
    source: 'published',
    bundleVersion: bundle.version,
    publishedAt: bundle.published_at || new Date().toISOString(),
    publishedBy: bundle.published_by || null,
    modifiers: bundle.modifiers ? hydrateModifiers(bundle.modifiers) : null,
    modifiersVersion: bundle.modifiers_version || bundle.version,
    redFlags,
  };
}

export function getActiveLibraryBundlePreview(
  builtinModifiers: Array<Parameters<typeof serializeModifier>[0]>,
): ClinicalLibraryBundle {
  const mods = state.modifiers
    ? state.modifiers.map((m) => serializeModifier(m))
    : builtinModifiers.map((m) => serializeModifier(m));
  return {
    version: state.bundleVersion,
    modifiers: {
      version: state.modifiersVersion,
      modifiers: mods,
    },
    red_flags: getRedFlagLibrary(),
    meta: {
      version: state.bundleVersion,
      published_at: state.publishedAt,
      published_by: state.publishedBy,
      source: state.source,
    },
  };
}
