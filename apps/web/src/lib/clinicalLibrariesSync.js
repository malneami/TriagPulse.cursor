import { applyClinicalLibraryBundle, resetClinicalLibrariesToBuiltin } from '@triagepulse/clinical';
import { api } from '@/api/client';

/** Load active published libraries into the browser clinical runtime (SSOT sync). */
export async function syncClinicalLibrariesFromApi() {
  try {
    const current = await api.clinicalLibraries.current();
    const meta = current.bundle?.meta;
    if (meta?.source === 'published' && current.bundle) {
      applyClinicalLibraryBundle({
        version: current.bundle.version,
        modifiers: current.bundle.modifiers?.modifiers || null,
        modifiers_version: current.bundle.modifiers?.version,
        red_flags: current.bundle.red_flags,
        published_at: meta.published_at,
        published_by: meta.published_by,
      });
      return current.versions;
    }
    resetClinicalLibrariesToBuiltin();
    return current.versions;
  } catch {
    // Offline / unauthorized — keep builtin
    return null;
  }
}
