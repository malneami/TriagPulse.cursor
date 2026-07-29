export function determineVisualTriageOutcome(sectionA, infectiousScore, monkeypoxRisk) {
  const criticalClinical = Object.values(sectionA).some(v => v === 'red');

  if (criticalClinical) {
    return {
      category: 'CRITICAL',
      destination_ar: 'غرفة الإنعاش — فوراً',
      destination_en: 'Resuscitation Room — Immediately',
      color: '#E24B4A',
      icon: '🚨',
      actions: [
        'وجّه للإنعاش فوراً — Direct to resus immediately',
        'أبلغ الفريق الطبي — Alert medical team',
        'لا تسجيل — لا انتظار — No registration, no waiting',
      ],
    };
  }

  if (infectiousScore >= 4) {
    return {
      category: 'RESPIRATORY_PATHWAY',
      destination_ar: 'المسار التنفسي — قبل غرفة الانتظار',
      destination_en: 'Respiratory Pathway — Before Waiting Room',
      color: '#9F4EBB',
      icon: '🫁',
      actions: [
        '🧴 غسل اليدين الآن — Hand hygiene now',
        '😷 كمامة جراحية — Surgical mask',
        '🚶 وجّه عبر المسار التنفسي — Respiratory pathway',
        '👨‍⚕️ أبلغ الطبيب للتقييم — Inform MD',
        '🧪 COVID/MERS وفق تعريفات الحالات — Test per case definitions',
      ],
    };
  }

  if (monkeypoxRisk === 'suspected') {
    return {
      category: 'MONKEYPOX_ISOLATION',
      destination_ar: 'عزل فوري — جدري القرود مشتبه',
      destination_en: 'Immediate Isolation — Suspected Monkeypox',
      color: '#B45309',
      icon: '⚠️',
      actions: [
        '🏥 غرفة عزل منفردة — Single isolation room',
        '😷 كمامة للمريض فوراً — Mask patient now',
        '🥼 PPE قبل الدخول — Don PPE before entry',
        '📞 أبلغ الطبيب المسؤول فوراً — Notify physician immediately',
        '🚫 ممنوع غرفة الانتظار — No general waiting room',
      ],
    };
  }

  if (infectiousScore >= 2) {
    return {
      category: 'MONITOR_INFECTIOUS',
      destination_ar: 'كمامة ومراقبة — مخاطر معتدلة',
      destination_en: 'Mask and Monitor — Moderate Risk',
      color: '#EF9F27',
      icon: '😷',
      actions: [
        '😷 أعطِ كمامة جراحية — Give surgical mask',
        '👁 اجلس في منطقة مراقبة — Seat in monitored area',
        '📋 وجّه للفرز الكامل — Proceed to full CTAS triage',
      ],
    };
  }

  return {
    category: 'STANDARD',
    destination_ar: 'تسجيل ثم فرز كامل',
    destination_en: 'Registration then Full CTAS',
    color: '#0F6E56',
    icon: '✅',
    actions: ['📋 وجّه للتسجيل — Direct to registration'],
  };
}