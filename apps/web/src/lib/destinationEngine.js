export function generatePatientId() {
  // Browser localStorage counters can duplicate across devices. Use a timestamp +
  // random suffix so each triage station can create safer temporary IDs before
  // a hospital MRN is assigned/confirmed.
  const now = new Date();
  const stamp = now.toISOString().replace(/[-:TZ.]/g, '').slice(2, 14);
  const random = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `VT-${stamp}-${random}`;
}

export function assignDestination({ sectionA, respiratoryScore, monkeypoxRisk, patientAge }) {
  const age = parseFloat(patientAge);
  const isChildUnder14 = !isNaN(age) && age < 14;

  const redFlags = [
    sectionA.breathing === 'red',
    sectionA.consciousness === 'red',
    sectionA.bleeding === 'red',
    sectionA.skin === 'red',
    sectionA.mobility === 'red',
  ].filter(Boolean).length;

  // 2+ red flags — resuscitation
  if (redFlags >= 2) {
    if (isChildUnder14) {
      return {
        destination: 'PEDIATRIC_RESUS',
        destination_ar: 'إنعاش الأطفال',
        destination_en: 'Pediatric Resuscitation',
        color: '#E24B4A', icon: '🚨👶', priority: 1, estimated_ctas: 1,
        bypass_registration: true, bypass_waiting_room: true,
        actions_ar: ['وجّه لإنعاش الأطفال فوراً', 'أبلغ طبيب الأطفال', 'لا تسجيل — التسجيل على السرير', 'الفرز يتم بواسطة الطبيب'],
        actions_en: ['Direct to pediatric resus immediately', 'Alert pediatric physician', 'No registration — bedside only', 'Triage by physician at bedside'],
      };
    }
    return {
      destination: 'RESUSCITATION',
      destination_ar: 'غرفة الإنعاش',
      destination_en: 'Resuscitation Room',
      color: '#E24B4A', icon: '🚨', priority: 1, estimated_ctas: 1,
      bypass_registration: true, bypass_waiting_room: true,
      actions_ar: ['وجّه للإنعاش فوراً', 'أبلغ الفريق الطبي', 'لا تسجيل — التسجيل يتم على السرير', 'الفرز يتم بواسطة الطبيب'],
      actions_en: ['Direct immediately to resus room', 'Alert medical team now', 'No registration — bedside registration', 'Triage by physician at bedside'],
    };
  }

  // 1 red flag
  if (redFlags === 1) {
    if (isChildUnder14) {
      return {
        destination: 'PEDIATRIC_RESUS',
        destination_ar: 'إنعاش الأطفال',
        destination_en: 'Pediatric Resuscitation',
        color: '#E24B4A', icon: '🚨👶', priority: 1, estimated_ctas: 1,
        bypass_registration: true, bypass_waiting_room: true,
        actions_ar: ['وجّه لإنعاش الأطفال فوراً', 'أبلغ طبيب الأطفال', 'لا تسجيل'],
        actions_en: ['Direct to pediatric resus immediately', 'Alert pediatric physician', 'No registration'],
      };
    }
    return {
      destination: 'RESUSCITATION',
      destination_ar: 'غرفة الإنعاش',
      destination_en: 'Resuscitation Room',
      color: '#E24B4A', icon: '🚨', priority: 1, estimated_ctas: 2,
      bypass_registration: true, bypass_waiting_room: false,
      actions_ar: ['وجّه للإنعاش فوراً', 'أبلغ الفريق الطبي', 'الفرز على السرير'],
      actions_en: ['Direct to resus immediately', 'Alert medical team', 'Bedside triage'],
    };
  }

  // Respiratory score ≥ 4 or monkeypox suspected
  if (respiratoryScore >= 4 || monkeypoxRisk === 'suspected') {
    return {
      destination: 'RESPIRATORY',
      destination_ar: 'المنطقة التنفسية',
      destination_en: 'Respiratory Area',
      color: '#9F4EBB', icon: '🫁', priority: 2, estimated_ctas: null,
      bypass_registration: false, bypass_waiting_room: true, infectious_protocol: true,
      actions_ar: ['غسل اليدين الآن', 'أعطِ كمامة جراحية', 'وجّه عبر المسار التنفسي', 'أبلغ الطبيب للتقييم', 'COVID/MERS وفق تعريفات الحالات'],
      actions_en: ['Hand hygiene now', 'Give surgical mask', 'Direct through respiratory pathway', 'Inform MD for assessment', 'COVID/MERS test per case definitions'],
    };
  }

  // Moderate respiratory risk
  if (respiratoryScore >= 2) {
    if (isChildUnder14) {
      return {
        destination: 'PEDIATRIC_OBSERVATION',
        destination_ar: 'ملاحظة الأطفال',
        destination_en: 'Pediatric Observation',
        color: '#EF9F27', icon: '👶', priority: 2,
        bypass_registration: false, bypass_waiting_room: false,
        actions_ar: ['أعطِ كمامة جراحية', 'اجلس في منطقة مراقبة', 'وجّه لملاحظة الأطفال'],
        actions_en: ['Give surgical mask', 'Seat in monitored area', 'Direct to pediatric observation'],
      };
    }
    return {
      destination: 'RESPIRATORY',
      destination_ar: 'المنطقة التنفسية',
      destination_en: 'Respiratory Area',
      color: '#EF9F27', icon: '😷', priority: 2,
      bypass_registration: false, bypass_waiting_room: false,
      actions_ar: ['أعطِ كمامة جراحية', 'اجلس في منطقة مراقبة', 'وجّه للفرز الكامل'],
      actions_en: ['Give surgical mask', 'Seat in monitored area', 'Proceed to full CTAS triage'],
    };
  }

  // Pediatric — stable
  if (isChildUnder14) {
    return {
      destination: 'PEDIATRIC_OBSERVATION',
      destination_ar: 'ملاحظة الأطفال',
      destination_en: 'Pediatric Observation',
      color: '#378ADD', icon: '👶', priority: 3,
      bypass_registration: false, bypass_waiting_room: false,
      actions_ar: ['وجّه لملاحظة الأطفال', 'التسجيل ثم فرز الأطفال PaedCTAS', 'أدخل وزن الطفل بالكيلوغرام'],
      actions_en: ['Direct to pediatric observation', 'Registration then PaedCTAS', 'Enter child weight in kg'],
    };
  }

  // Adult stable — default
  return {
    destination: 'ADULT_OBSERVATION',
    destination_ar: 'ملاحظة البالغين',
    destination_en: 'Adult Observation',
    color: '#0F6E56', icon: '🏥', priority: 4,
    bypass_registration: false, bypass_waiting_room: false,
    actions_ar: ['التسجيل', 'الفرز الكامل CTAS'],
    actions_en: ['Registration', 'Full CTAS triage'],
  };
}