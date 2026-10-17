/** Staff password rule: at least 10 characters with a letter and a digit, not the e-mail. */
export const PASSWORD_MIN = 10;

export function passwordProblem(password: string, email?: string): string | null {
  const p = String(password || '');
  if (p.length < PASSWORD_MIN) return `Password must be at least ${PASSWORD_MIN} characters.`;
  if (p.length > 128) return 'Password is too long.';
  if (!/[A-Za-z]/.test(p) || !/\d/.test(p)) return 'Password must contain letters and numbers.';
  if (email && p.toLowerCase().includes(email.split('@')[0].toLowerCase())) return 'Password must not contain the e-mail name.';
  return null;
}
