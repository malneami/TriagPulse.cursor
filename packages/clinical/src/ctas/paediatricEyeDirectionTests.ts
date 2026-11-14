import { PAEDIATRIC_EYE_DIRECTIONS as doc } from './paediatricEyeDirections';

type Assert = (cond: boolean, id: string, name: string, detail?: string) => void;

const AREAS = ['PEDIATRIC_RESUS', 'PEDIATRIC_OBSERVATION', 'PEDIATRIC_CLINIC', 'PEDS_FAST_TRACK'];
const ALLOWED_AREAS_FOR_NON_ZONE = ['Ophthalmology referral (same day)', 'Ophthalmology clinic (24–72 h)', 'Other (write in notes)'];

export function runPaediatricEyeDirectionTests(assert: Assert): void {
  const entries = (doc as any).entries as Array<any>;
  assert(entries.length === 17, 'PEY-01', 'paediatric eye sheet has 17 presentations', `got ${entries.length}`);
  for (const e of entries) {
    assert(Number.isInteger(e.reviewer_ctas) && e.reviewer_ctas >= 1 && e.reviewer_ctas <= 5, `PEY-CTAS-${e.id}`, `${e.id} reviewer CTAS is 1–5`, `got ${e.reviewer_ctas}`);
    const okArea = AREAS.includes(e.reviewer_area) || ALLOWED_AREAS_FOR_NON_ZONE.includes(e.reviewer_area);
    assert(okArea, `PEY-AREA-${e.id}`, `${e.id} reviewer area is a known destination`, `got ${e.reviewer_area}`);
  }
  const pe01 = entries.find((e) => e.id === 'PE-01');
  assert(pe01?.reviewer_ctas === 2 && pe01?.reviewer_area === 'PEDIATRIC_RESUS', 'PEY-02', 'PE-01 chemical eye injury: CTAS 2, Resus');
}
