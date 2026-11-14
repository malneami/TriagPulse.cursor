// Reviewed paediatric eye destinations (clinician direction, 2026-11-14). Not used by the engine until wired and tested.
export const PAEDIATRIC_EYE_DIRECTIONS = {
  "status": "clinician_direction_recorded_not_wired_to_engine",
  "version": "2026-11-14",
  "note": "Paediatric eye destinations as directed by the reviewing clinician. CTAS 2025 not yet verified. Not used by the engine until wired and tested.",
  "entries": [
    {
      "id": "PE-01",
      "presentation": "Child: chemical splash to the eye",
      "proposed_ctas": 2,
      "proposed_area": "PEDIATRIC_RESUS (immediate irrigation) + urgent ophthalmology",
      "reviewer_ctas": 2,
      "reviewer_area": "PEDIATRIC_RESUS",
      "source": "2018 CTAS booklet / Alder Hey (see Basis in sheet)"
    },
    {
      "id": "PE-02",
      "presentation": "Child: penetrating eye injury (e.g. metal, stick)",
      "proposed_ctas": 2,
      "proposed_area": "PEDIATRIC_OBSERVATION + urgent ophthalmology (same day)",
      "reviewer_ctas": 2,
      "reviewer_area": "PEDIATRIC_OBSERVATION",
      "source": "2018 CTAS booklet / Alder Hey (see Basis in sheet)"
    },
    {
      "id": "PE-03",
      "presentation": "Child: sudden or abrupt change in vision",
      "proposed_ctas": 2,
      "proposed_area": "PEDIATRIC_OBSERVATION + ophthalmology same day",
      "reviewer_ctas": 2,
      "reviewer_area": "PEDIATRIC_OBSERVATION",
      "source": "2018 CTAS booklet / Alder Hey (see Basis in sheet)"
    },
    {
      "id": "PE-04",
      "presentation": "Child: periorbital swelling with fever (preseptal / orbital cellulitis features)",
      "proposed_ctas": 2,
      "proposed_area": "PEDIATRIC_OBSERVATION (IV antibiotics; imaging if orbital)",
      "reviewer_ctas": 2,
      "reviewer_area": "PEDIATRIC_OBSERVATION",
      "source": "2018 CTAS booklet / Alder Hey (see Basis in sheet)"
    },
    {
      "id": "PE-05",
      "presentation": "Child: periorbital swelling, fever, no cellulitis features",
      "proposed_ctas": 5,
      "proposed_area": "PEDS_FAST_TRACK or PEDIATRIC_CLINIC if febrile",
      "reviewer_ctas": 4,
      "reviewer_area": "PEDIATRIC_CLINIC",
      "source": "2018 CTAS booklet / Alder Hey (see Basis in sheet)"
    },
    {
      "id": "PE-06",
      "presentation": "Child: foreign body in eye, penetrating",
      "proposed_ctas": 2,
      "proposed_area": "PEDIATRIC_OBSERVATION + ophthalmology same day",
      "reviewer_ctas": 2,
      "reviewer_area": "PEDIATRIC_OBSERVATION",
      "source": "2018 CTAS booklet / Alder Hey (see Basis in sheet)"
    },
    {
      "id": "PE-07",
      "presentation": "Child: foreign body in eye, acute peripheral, mild pain",
      "proposed_ctas": 5,
      "proposed_area": "PEDS_FAST_TRACK",
      "reviewer_ctas": 4,
      "reviewer_area": "PEDS_FAST_TRACK",
      "source": "2018 CTAS booklet / Alder Hey (see Basis in sheet)"
    },
    {
      "id": "PE-08",
      "presentation": "Child: blunt eye trauma with visual loss",
      "proposed_ctas": 2,
      "proposed_area": "PEDIATRIC_OBSERVATION + urgent ophthalmology",
      "reviewer_ctas": 2,
      "reviewer_area": "PEDIATRIC_OBSERVATION",
      "source": "2018 CTAS booklet / Alder Hey (see Basis in sheet)"
    },
    {
      "id": "PE-09",
      "presentation": "Child: eye trauma, central, mild pain (<4)",
      "proposed_ctas": 4,
      "proposed_area": "PEDIATRIC_CLINIC + ophthalmology clinic",
      "reviewer_ctas": 4,
      "reviewer_area": "PEDS_FAST_TRACK",
      "source": "2018 CTAS booklet / Alder Hey (see Basis in sheet)"
    },
    {
      "id": "PE-10",
      "presentation": "Child: acute red eye / discharge",
      "proposed_ctas": 4,
      "proposed_area": "PEDIATRIC_CLINIC",
      "reviewer_ctas": 4,
      "reviewer_area": "PEDIATRIC_CLINIC",
      "source": "2018 CTAS booklet / Alder Hey (see Basis in sheet)"
    },
    {
      "id": "PE-11",
      "presentation": "Child: chronic red eye / discharge",
      "proposed_ctas": 5,
      "proposed_area": "PEDS_FAST_TRACK or GP referral",
      "reviewer_ctas": 5,
      "reviewer_area": "PEDIATRIC_CLINIC",
      "source": "2018 CTAS booklet / Alder Hey (see Basis in sheet)"
    },
    {
      "id": "PE-12",
      "presentation": "Child: photophobia",
      "proposed_ctas": 4,
      "proposed_area": "PEDIATRIC_CLINIC",
      "reviewer_ctas": 4,
      "reviewer_area": "PEDIATRIC_CLINIC",
      "source": "2018 CTAS booklet / Alder Hey (see Basis in sheet)"
    },
    {
      "id": "PE-13",
      "presentation": "Child: acute diplopia",
      "proposed_ctas": 3,
      "proposed_area": "PEDIATRIC_CLINIC + ophthalmology same day",
      "reviewer_ctas": 3,
      "reviewer_area": "PEDIATRIC_OBSERVATION",
      "source": "2018 CTAS booklet / Alder Hey (see Basis in sheet)"
    },
    {
      "id": "PE-14",
      "presentation": "Child: chronic diplopia",
      "proposed_ctas": 4,
      "proposed_area": "PEDIATRIC_CLINIC",
      "reviewer_ctas": 4,
      "reviewer_area": "PEDIATRIC_CLINIC",
      "source": "2018 CTAS booklet / Alder Hey (see Basis in sheet)"
    },
    {
      "id": "PE-15",
      "presentation": "Child: chronic or gradual change in vision",
      "proposed_ctas": 4,
      "proposed_area": "PEDIATRIC_CLINIC + ophthalmology clinic",
      "reviewer_ctas": 4,
      "reviewer_area": "PEDIATRIC_CLINIC",
      "source": "2018 CTAS booklet / Alder Hey (see Basis in sheet)"
    },
    {
      "id": "PE-16",
      "presentation": "Child: eye pain, chronic",
      "proposed_ctas": 5,
      "proposed_area": "PEDS_FAST_TRACK",
      "reviewer_ctas": 5,
      "reviewer_area": "PEDIATRIC_CLINIC",
      "source": "2018 CTAS booklet / Alder Hey (see Basis in sheet)"
    },
    {
      "id": "PE-17",
      "presentation": "Child: headache with visual disturbance ± eye pain",
      "proposed_ctas": 2,
      "proposed_area": "PEDIATRIC_OBSERVATION",
      "reviewer_ctas": 2,
      "reviewer_area": "PEDIATRIC_OBSERVATION",
      "source": "2018 CTAS booklet / Alder Hey (see Basis in sheet)"
    }
  ]
} as const;
