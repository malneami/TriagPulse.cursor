import { CTAS_MODIFIER_LIBRARY, MODIFIER_LIBRARY_VERSION } from '../ctas/modifierLibrary.js';
import { buildDefaultRedFlagLibrary } from './redFlagLibrary';
import {
  applyClinicalLibraryBundle,
  getActiveLibraryBundlePreview,
  getLibraryVersions,
  resetClinicalLibrariesToBuiltin,
  serializeModifier,
} from './runtime';
import type { ClinicalLibraryBundle, SerializableModifier } from './types';

export function buildBuiltinClinicalBundle(): ClinicalLibraryBundle {
  const modifiers = (CTAS_MODIFIER_LIBRARY as Array<Parameters<typeof serializeModifier>[0]>).map(
    (m) => serializeModifier(m),
  );
  return {
    version: `builtin-${MODIFIER_LIBRARY_VERSION}`,
    modifiers: {
      version: MODIFIER_LIBRARY_VERSION,
      modifiers,
    },
    red_flags: buildDefaultRedFlagLibrary(),
    meta: {
      version: `builtin-${MODIFIER_LIBRARY_VERSION}`,
      published_at: null,
      published_by: null,
      source: 'builtin',
    },
  };
}

export function getCurrentClinicalBundle(): ClinicalLibraryBundle {
  return getActiveLibraryBundlePreview(
    CTAS_MODIFIER_LIBRARY as Array<Parameters<typeof serializeModifier>[0]>,
  );
}

export function exportBuiltinModifiers(): SerializableModifier[] {
  return (CTAS_MODIFIER_LIBRARY as Array<Parameters<typeof serializeModifier>[0]>).map((m) =>
    serializeModifier(m),
  );
}

export {
  applyClinicalLibraryBundle,
  getLibraryVersions,
  resetClinicalLibrariesToBuiltin,
  serializeModifier,
};
