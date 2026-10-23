#!/usr/bin/env node
/**
 * Browser check of sign-in sessions (review H3), against the API serving the web app
 * (SERVE_WEB_DIR). Run in CI after scripts/e2e-api.mjs:
 *
 *   APP_URL=http://localhost:3001 node scripts/e2e-browser-session.mjs
 *
 * Checks: sign-in works; no token is left in browser storage; the renewal cookie is
 * HttpOnly (page scripts cannot read it); a page reload keeps the person signed in (cookie
 * renewal); sign-out returns to the login page and a reload stays signed out.
 */
import { chromium } from 'playwright';

const APP = (process.env.APP_URL || 'http://localhost:3001').replace(/\/$/, '');
const EMAIL = process.env.E2E_EMAIL || 'nurse@triagepulse.local';
const PASSWORD = process.env.DEMO_PASSWORD || 'triage123';

let passed = 0;
function check(condition, label, detail = '') {
  if (!condition) {
    console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
    if (process.env.GITHUB_ACTIONS) console.log(`::error title=Browser check failed::${label}${detail ? ` — ${detail}` : ''}`);
    process.exit(1);
  }
  passed += 1;
  console.log(`ok    ${label}`);
}

// A Playwright error (timeout, missing element) is reported like a failed check, with the
// page address, so CI shows why it stopped.
let currentPage = null;
process.on('unhandledRejection', (err) => {
  const where = currentPage ? currentPage.url() : '';
  const msg = String(err?.message || err).split('\n').slice(0, 3).join(' ');
  console.error(`FAIL  ${msg} @ ${where}`);
  if (process.env.GITHUB_ACTIONS) console.log(`::error title=Browser check crashed::${msg} @ ${where}`);
  process.exit(1);
});

try {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  currentPage = page;
  const signedIn = () => page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 15000 }).then(() => true, () => false);

  await page.goto(`${APP}/login`);
  await page.locator('#login-email').fill(EMAIL);
  await page.locator('#login-password').fill(PASSWORD);
  await page.getByRole('button', { name: /Sign in/ }).click();
  check(await signedIn(), 'the nurse signs in through the login page', page.url());

  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }));
  check(!/eyJ[\w-]+\.[\w-]+\./.test(stored), 'no sign-in token is kept in browser storage');
  check(!(await page.evaluate(() => document.cookie)).includes('tp_refresh'), 'page scripts cannot read the renewal cookie (HttpOnly)');
  const cookies = await context.cookies();
  const refresh = cookies.find((c) => c.name === 'tp_refresh');
  check(!!refresh && refresh.httpOnly && refresh.sameSite === 'Strict' && refresh.path === '/api/auth', 'the browser holds an HttpOnly, SameSite=Strict renewal cookie for /api/auth', JSON.stringify(refresh && { ...refresh, value: '…' }));

  await page.reload();
  await page.waitForLoadState('networkidle');
  check(!page.url().includes('/login'), 'a page reload keeps the nurse signed in (renewed from the cookie)', page.url());
  const after = (await context.cookies()).find((c) => c.name === 'tp_refresh');
  check(!!after && after.value !== refresh.value, 'the renewal on reload rotated the cookie');

  await page.getByRole('button', { name: /Menu/ }).click();
  await page.getByRole('menuitem', { name: /Sign out$/ }).click();
  await page.waitForURL(/\/login/, { timeout: 15000 });
  check(page.url().includes('/login'), 'sign-out returns to the login page');
  // Sign-out ends with a full page load of /login; let it finish before opening the app
  // again, otherwise the two navigations collide (net::ERR_ABORTED).
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(500);
  try {
    await page.goto(`${APP}/tracking`);
  } catch (err) {
    if (!/ERR_ABORTED/.test(String(err?.message))) throw err;
    await page.waitForTimeout(1000);
    await page.goto(`${APP}/tracking`);
  }
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1000);
  check(page.url().includes('/login'), 'after sign-out, opening the app again asks to sign in', page.url());

  await browser.close();
} catch (err) {
  const where = currentPage ? currentPage.url() : '';
  const msg = String(err?.message || err).split('\n').slice(0, 4).join(' ');
  console.error(`FAIL  ${msg} @ ${where}`);
  if (process.env.GITHUB_ACTIONS) console.log(`::error title=Browser check crashed::${msg} @ ${where}`);
  process.exit(1);
}
console.log(`\nAll ${passed} browser checks passed.`);
