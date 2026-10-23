// Bundles the vendored Boosthis Node kit (vendor/boosthis, TypeScript ES modules, kept
// byte for byte as shipped) into one CommonJS file the compiled API can require():
// dist/boosthis-kit.cjs. The kit files themselves are never edited.
import { build } from 'esbuild';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const kit = resolve(here, '../../../vendor/boosthis/lib');
const entry = resolve(kit, 'boosthis-runtime-node/src/index.ts');
if (!existsSync(entry)) {
  console.error(`[boosthis] kit not found at ${entry}`);
  process.exit(1);
}

await build({
  entryPoints: [entry],
  outfile: resolve(here, '../dist/boosthis-kit.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  logLevel: 'warning',
  // The kit resolves its rule data by package name; point it at the vendored copy.
  alias: {
    'boosthis-checklist': resolve(kit, 'boosthis-checklist/src/index.ts'),
    '@workspace/boosthis-runtime-node': entry,
  },
  // Drivers and frameworks the kit only observes when the app already loaded them.
  external: ['pg', 'express'],
  // The kit uses import.meta.url (ES modules); give it this file's URL in CommonJS.
  banner: { js: 'const __boosthisMetaUrl = require("node:url").pathToFileURL(__filename).href;' },
  define: { 'import.meta.url': '__boosthisMetaUrl' },
});
console.log('[boosthis] kit bundled to dist/boosthis-kit.cjs');
