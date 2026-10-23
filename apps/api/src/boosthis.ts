import { existsSync } from 'fs';
import { join } from 'path';

/**
 * Boosthis performance monitoring (optional). It times requests, outbound calls and the
 * Node process, and sends labels and numbers to the Boosthis dashboard: never request
 * or response bodies, headers, cookies, query values or SQL. The kit is vendored in
 * vendor/boosthis and bundled into dist/boosthis-kit.cjs at build time.
 *
 * Off unless BOOSTHIS_PROJECT_KEY is set, so local runs never load it. BOOSTHIS_LOCAL_ONLY=1
 * attaches it with no key: it measures in-process and sends nothing (CI uses this to run the
 * whole app with the kit in place). BOOSTHIS_DISABLED=1 switches it off without a release.
 * Must run before NestFactory.create(), because it watches the HTTP server as it is created.
 * Any failure is logged and the app carries on without it.
 */
export function startBoosthis(): void {
  const key = process.env.BOOSTHIS_PROJECT_KEY?.trim();
  if (/^(1|true|yes|on)$/i.test(process.env.BOOSTHIS_DISABLED?.trim() || '')) {
    console.log('[boosthis] switched off (BOOSTHIS_DISABLED)');
    return;
  }
  const localOnly = /^(1|true|yes|on)$/i.test(process.env.BOOSTHIS_LOCAL_ONLY?.trim() || '');
  if (!key && !localOnly) {
    console.log('[boosthis] not set up (no BOOSTHIS_PROJECT_KEY); monitoring off');
    return;
  }
  const kitFile = join(__dirname, '..', 'boosthis-kit.cjs');
  if (!existsSync(kitFile)) {
    console.warn(`[boosthis] kit bundle missing at ${kitFile}; monitoring off`);
    return;
  }
  const installId = process.env.BOOSTHIS_INSTALL_ID?.trim();
  if (key && !installId) {
    console.warn('[boosthis] BOOSTHIS_INSTALL_ID not set; monitoring off');
    return;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const kit = require(kitFile);
    kit.attach();
    if (!key) return; // local only: measured in-process, nothing registers or leaves
    kit.enableTelemetry({
      installId,
      inviteKey: key,
      endpoint: 'https://www.boosthis.com/api',
      appName: 'TriagePulse',
    });
  } catch (err) {
    console.warn(`[boosthis] could not start; the app continues without it: ${(err as Error)?.message}`);
  }
}
