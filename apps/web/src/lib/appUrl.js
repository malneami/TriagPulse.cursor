/**
 * Resolve a path against Vite's base (needed for GitHub Pages project sites).
 * @param {string} path e.g. '/login' or 'login'
 */
export function appHref(path = '/') {
  const base = import.meta.env.BASE_URL || '/';
  const clean = String(path || '/').replace(/^\//, '');
  if (!clean) return base;
  return `${base}${clean}`.replace(/\/{2,}/g, '/');
}
