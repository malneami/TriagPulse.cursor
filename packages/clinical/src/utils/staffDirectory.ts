/**
 * Staff sign-up (join link): job titles and HMG branches shown on the form and checked by the API.
 * Job title is a label only; the access level is chosen by the admin on approval.
 * Edit BRANCHES here to change the list (keep ids stable; "other" asks for a name).
 */
export const JOB_TITLES = [
  { id: 'nurse', en: 'Nurse', ar: 'ممرض' },
  { id: 'pct', en: 'PCT', ar: 'فني رعاية المرضى' },
  { id: 'physician', en: 'Physician', ar: 'طبيب' },
  { id: 'paramedic', en: 'Paramedic', ar: 'مسعف' },
  { id: 'other', en: 'Other', ar: 'أخرى' },
] as const;

export const BRANCHES = [
  { id: 'takhassusi', en: 'Al Takhassusi (Riyadh)', ar: 'التخصصي (الرياض)' },
  { id: 'olaya', en: 'Al Olaya (Riyadh)', ar: 'العليا (الرياض)' },
  { id: 'rayyan', en: 'Al Rayyan (Riyadh)', ar: 'الريان (الرياض)' },
  { id: 'suwaidi', en: 'Al Suwaidi (Riyadh)', ar: 'السويدي (الرياض)' },
  { id: 'sahafa', en: 'Al Sahafa (Riyadh)', ar: 'الصحافة (الرياض)' },
  { id: 'hamra', en: 'Al Hamra (Riyadh)', ar: 'الحمراء (الرياض)' },
  { id: 'khobar', en: 'Al Khobar', ar: 'الخبر' },
  { id: 'qassim', en: 'Al Qassim (Buraidah)', ar: 'القصيم (بريدة)' },
  { id: 'dubai_barsha', en: 'Al Barsha (Dubai)', ar: 'البرشاء (دبي)' },
  { id: 'dubai_hc', en: 'Dubai Healthcare City', ar: 'مدينة دبي الطبية' },
  { id: 'other', en: 'Other', ar: 'أخرى' },
] as const;

export type JobTitleId = (typeof JOB_TITLES)[number]['id'];
export type BranchId = (typeof BRANCHES)[number]['id'];

export function jobTitleLabel(id: string | null | undefined, other?: string | null): string {
  if (id === 'other') return other ? `Other: ${other}` : 'Other';
  return JOB_TITLES.find((j) => j.id === id)?.en ?? '';
}

export function branchLabel(id: string | null | undefined, other?: string | null): string {
  if (id === 'other') return other ? `Other: ${other}` : 'Other';
  return BRANCHES.find((b) => b.id === id)?.en ?? '';
}
