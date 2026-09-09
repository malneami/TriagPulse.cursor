/**
 * Official CTAS 2025 Complaint Database
 * Canadian Triage and Acuity Scale Interactive Quick Look Booklet 2025
 */

export const CTAS_DB = {
  SUBSTANCE_MISUSE: {
    color: '#6B0F2B', label_ar: 'إساءة استخدام المواد', label_en: 'Substance Misuse',
    complaints: {
      substance_misuse_intoxication: { label_en: 'Substance Misuse/Intoxication', label_ar: 'إساءة/تسمم بمواد', default_ctas: 4, specific_modifiers: [{ modifier: 'High Risk Substance/Unknown Substance', ctas: 2 }, { modifier: 'Uncertain Flight or Safety Risk', ctas: 2 }, { modifier: 'Known Pharmaceutical Drug with Unknown Therapeutic Dosage, Normal VS', ctas: 3 }, { modifier: 'Moderate Risk Substance Ingestion +/- Multi-Drug Ingestion', ctas: 3 }, { modifier: 'Known Pharmaceutical Drug Within Therapeutic Dosage, Normal VS', ctas: 4 }] },
      overdose_ingestion: { label_en: 'Overdose Ingestion', label_ar: 'جرعة زائدة', default_ctas: 3, specific_modifiers: [{ modifier: 'Attempted Suicide, Clear Plan', ctas: 2 }, { modifier: 'High Risk Substance/Unknown Substance', ctas: 2 }, { modifier: 'Uncertain Flight/Safety Risk', ctas: 2 }, { modifier: 'Moderate Risk Substance Ingestion +/- Multi-Drug Ingestion', ctas: 3 }, { modifier: 'Suicidal Ideation, No Plan', ctas: 3 }] },
      substance_withdrawal: { label_en: 'Substance Withdrawal', label_ar: 'انسحاب مواد', default_ctas: 4, specific_modifiers: [{ modifier: 'Actively Seizing', ctas: 1 }, { modifier: 'Severe Anxiety/Agitation', ctas: 2 }, { modifier: 'Uncertain Flight or Safety Risk', ctas: 2 }, { modifier: 'Recent Seizures, Postictal, Agitated', ctas: 2 }, { modifier: 'Severe Visual or Auditory Hallucinations', ctas: 2 }, { modifier: 'Moderate Anxiety/Agitation', ctas: 3 }, { modifier: 'Moderate Visual or Auditory Hallucinations', ctas: 3 }, { modifier: 'Tremor, Acute, Uncontrolled +/- Distress', ctas: 3 }, { modifier: 'Mild Anxiety/Agitation', ctas: 4 }, { modifier: 'Mild Visual or Auditory Hallucinations', ctas: 4 }] },
    }
  },
  ENT_NOSE: {
    color: '#8B0000', label_ar: 'الأنف', label_en: 'ENT - Nose',
    complaints: {
      epistaxis: { label_en: 'Epistaxis', label_ar: 'رعاف', default_ctas: 5, specific_modifiers: [{ modifier: 'Uncontrolled epistaxis', ctas: 2 }, { modifier: 'Bleeding controlled with pressure', ctas: 3 }, { modifier: 'Acute epistaxis, no active bleeding', ctas: 4 }, { modifier: 'Periodic/recurrent, no active bleeding', ctas: 5 }] },
      nasal_congestion: { label_en: 'Nasal Congestion/Hay Fever', label_ar: 'احتقان الأنف', default_ctas: 5, specific_modifiers: [{ modifier: 'Nasal congestion with known hay fever', ctas: 5 }] },
      foreign_body_nose: { label_en: 'Foreign Body, Nose', label_ar: 'جسم غريب في الأنف', default_ctas: 5, specific_modifiers: [{ modifier: 'Button battery with ANY symptoms', ctas: 1 }, { modifier: 'Button battery, Asymptomatic', ctas: 2 }, { modifier: 'Magnets inserted, more than one or unknown quantity', ctas: 3 }, { modifier: 'Foreign body in nose', ctas: 5 }] },
      urti_complaints: { label_en: 'URTI Complaints', label_ar: 'أعراض التهاب الجهاز التنفسي العلوي', default_ctas: 5, specific_modifiers: [{ modifier: 'Appears well, no fever', ctas: 5 }] },
      nasal_trauma: { label_en: 'Nasal Trauma', label_ar: 'رضح الأنف', default_ctas: 5, specific_modifiers: [{ modifier: 'Uncontrolled epistaxis', ctas: 2 }, { modifier: 'Nasal trauma, controlled', ctas: 5 }] },
    }
  },
  ENT_EAR: {
    color: '#A00000', label_ar: 'الأذن', label_en: 'ENT - Ear',
    complaints: {
      earache: { label_en: 'Earache', label_ar: 'ألم الأذن', default_ctas: 5, specific_modifiers: [{ modifier: 'Earache with mild pain', ctas: 5 }] },
      foreign_body_ear: { label_en: 'Foreign Body, Ear', label_ar: 'جسم غريب في الأذن', default_ctas: 5, specific_modifiers: [{ modifier: 'Acute Peripheral Severe Pain (8-10)', ctas: 3 }, { modifier: 'Acute Peripheral Moderate Pain (4-7)', ctas: 4 }, { modifier: 'Foreign body ear, mild pain (<4)', ctas: 5 }] },
      loss_of_hearing: { label_en: 'Loss of Hearing', label_ar: 'فقدان السمع', default_ctas: 5, specific_modifiers: [{ modifier: 'Hearing loss, sudden onset', ctas: 3 }, { modifier: 'Hearing loss, gradual onset', ctas: 5 }] },
      tinnitus: { label_en: 'Tinnitus', label_ar: 'طنين الأذن', default_ctas: 4, specific_modifiers: [{ modifier: 'Suspected Aspirin Ingestion', ctas: 2 }, { modifier: 'Tinnitus', ctas: 4 }] },
      ear_injury: { label_en: 'Ear Injury', label_ar: 'إصابة الأذن', default_ctas: 5, specific_modifiers: [{ modifier: 'Amputation', ctas: 2 }, { modifier: 'Severe cold injury, with Blanching or Cyanosis', ctas: 3 }, { modifier: 'Minor cold injury/no discoloration', ctas: 4 }, { modifier: 'Laceration requiring sutures', ctas: 4 }, { modifier: 'Laceration/abrasion, no sutures required', ctas: 5 }] },
      discharge_ear: { label_en: 'Discharge, Ear', label_ar: 'إفراز من الأذن', default_ctas: 4, specific_modifiers: [{ modifier: 'Fever (appears unwell)', ctas: 3 }, { modifier: 'Discharge ear (appears well)', ctas: 4 }] },
    }
  },
  TRAUMA: {
    color: '#CC3300', label_ar: 'الإصابات والرضح', label_en: 'Trauma',
    complaints: {
      multisystem_trauma_penetrating: { label_en: 'Multisystem Trauma - Penetrating', label_ar: 'رضح متعدد الأجهزة - نافذ', default_ctas: 3, specific_modifiers: [{ modifier: 'Penetrating Abdominal Trauma in Pregnancy', ctas: 1 }, { modifier: 'Penetrating Head/Chest/Abdomen', ctas: 2 }, { modifier: 'Neurovascular Compromise of Extremity', ctas: 2 }, { modifier: 'Major Trauma - Penetrating', ctas: 3 }] },
      multisystem_trauma_blunt: { label_en: 'Multisystem Trauma - Blunt', label_ar: 'رضح متعدد الأجهزة - حاد', default_ctas: 3, specific_modifiers: [{ modifier: 'Major Blunt Trauma in Pregnancy > 20 Weeks', ctas: 2 }, { modifier: 'Neurovascular Compromise of Extremity', ctas: 2 }, { modifier: 'Prolonged Spinal Immobilization', ctas: 3 }, { modifier: 'Minor Blunt Trauma in Pregnancy > 20 Weeks', ctas: 3 }, { modifier: 'Multisystem Trauma - Blunt', ctas: 3 }] },
      head_injury: { label_en: 'Head Injury', label_ar: 'إصابة الرأس', default_ctas: 4, specific_modifiers: [{ modifier: 'With Penetrating Trauma', ctas: 1 }, { modifier: 'New Focal Neurological Findings', ctas: 2 }, { modifier: 'History of Loss of Consciousness', ctas: 3 }, { modifier: 'Prolonged Spinal Immobilization', ctas: 3 }, { modifier: 'No History of Loss of Consciousness', ctas: 4 }] },
      sexual_assault: { label_en: 'Sexual Assault', label_ar: 'اعتداء جنسي', default_ctas: 3, specific_modifiers: [{ modifier: 'Evidence or Reported Attempted Strangulation', ctas: 2 }, { modifier: 'Within Last 7 Days or Obvious/Reported Distress', ctas: 2 }, { modifier: 'Greater than 7 Days', ctas: 3 }] },
      traumatic_back_spine: { label_en: 'Traumatic Back/Spine Injury', label_ar: 'إصابة الظهر والعمود الفقري', default_ctas: 4, specific_modifiers: [{ modifier: 'Prolonged Immobilization on Ground > 24 Hours', ctas: 2 }, { modifier: 'Neuro-deficit +/- Bowel Bladder Problems', ctas: 2 }, { modifier: 'Prolonged Immobilization', ctas: 3 }] },
    }
  },
  CARDIOVASCULAR: {
    color: '#7B2D8B', label_ar: 'القلب والأوعية الدموية', label_en: 'Cardiovascular',
    complaints: {
      cardiac_arrest_non_traumatic: { label_en: 'Cardiac Arrest (Non-Traumatic)', label_ar: 'سكتة قلبية غير رضحية', default_ctas: 1, specific_modifiers: [{ modifier: 'Cardiac arrest, non-traumatic', ctas: 1 }] },
      cardiac_arrest_traumatic: { label_en: 'Cardiac Arrest (Traumatic)', label_ar: 'سكتة قلبية رضحية', default_ctas: 1, specific_modifiers: [{ modifier: 'Cardiac arrest, traumatic', ctas: 1 }] },
      chest_pain_cardiac: { label_en: 'Chest Pain (Cardiac Features)', label_ar: 'ألم صدري - قلبي', default_ctas: 2, specific_modifiers: [{ modifier: 'Chest Pain with cardiac features', ctas: 2 }, { modifier: 'Atypical Chest Pain with concerning features', ctas: 2 }] },
      chest_pain_non_cardiac: { label_en: 'Chest Pain (No Cardiac Features)', label_ar: 'ألم صدري - غير قلبي', default_ctas: 5, specific_modifiers: [{ modifier: 'Other Significant Chest Pain (Ripping, Tearing)', ctas: 2 }, { modifier: 'Chest Pain, non cardiac', ctas: 5 }] },
      cool_pulseless_limb: { label_en: 'Cool Pulseless Limb', label_ar: 'طرف بارد عديم النبض', default_ctas: 2, specific_modifiers: [{ modifier: 'Cool Pulseless limb', ctas: 2 }] },
      palpitations: { label_en: 'Palpitations/Irregular Heartbeat', label_ar: 'خفقان/اضطراب النظم', default_ctas: 4, specific_modifiers: [{ modifier: 'With Chest Pain Cardiac Features', ctas: 2 }, { modifier: 'History/documentation of Lethal Dysrhythmia', ctas: 2 }, { modifier: 'Acute onset/ongoing', ctas: 3 }, { modifier: 'Recent history of palpitations OR irregular heart rate, asymptomatic currently', ctas: 4 }] },
      hypertension: { label_en: 'Hypertension', label_ar: 'ارتفاع ضغط الدم', default_ctas: 4, specific_modifiers: [{ modifier: 'SBP >220 or DBP >130, with symptoms', ctas: 2 }, { modifier: 'SBP >220 or DBP >130, no symptoms', ctas: 3 }, { modifier: 'SBP 200-220 or DBP 110-130, with symptoms', ctas: 3 }, { modifier: 'SBP 200-220 or DBP 110-130, no symptoms', ctas: 4 }] },
      syncope: { label_en: 'Syncope/Pre-syncope', label_ar: 'إغماء/ما قبل الإغماء', default_ctas: 4, specific_modifiers: [{ modifier: 'New Dysrhythmia, irregular pulse/heart rate change', ctas: 2 }, { modifier: 'Syncope with no prodromal signs', ctas: 2 }, { modifier: 'Syncope during exercise', ctas: 2 }, { modifier: 'Syncope with prodromal symptoms', ctas: 3 }, { modifier: 'Syncope with sudden position change', ctas: 3 }, { modifier: 'Syncope with symptoms resolved, Normal VS', ctas: 4 }] },
    }
  },
  RESPIRATORY: {
    color: '#006600', label_ar: 'الجهاز التنفسي', label_en: 'Respiratory',
    complaints: {
      respiratory_arrest: { label_en: 'Respiratory Arrest', label_ar: 'توقف التنفس', default_ctas: 1, specific_modifiers: [{ modifier: 'Respiratory arrest', ctas: 1 }] },
      shortness_of_breath: { label_en: 'SOB - Shortness of Breath', label_ar: 'ضيق التنفس', default_ctas: 4, specific_modifiers: [{ modifier: 'Asthmatic (Severe)', ctas: 1 }, { modifier: 'Intubated or BVM Ventilations or BIPAP Applied', ctas: 1 }, { modifier: 'Asthmatic (Moderate)', ctas: 2 }, { modifier: 'SOB with Recent Blunt or Penetrating Injury', ctas: 2 }, { modifier: 'Asthmatic (Mild)', ctas: 3 }, { modifier: 'History of Shortness of Breath, Resolved', ctas: 4 }] },
      stridor_resp: { label_en: 'Stridor', label_ar: 'صرير', default_ctas: 3, specific_modifiers: [{ modifier: 'Airway Compromise', ctas: 1 }, { modifier: 'Increasing or Worsening Stridor', ctas: 1 }, { modifier: 'Audible or Marked Stridor', ctas: 2 }, { modifier: 'Recent Spell Consistent with Apnea', ctas: 2 }, { modifier: 'History of Spell Consistent with Apnea', ctas: 3 }] },
      allergic_reaction: { label_en: 'Allergic Reaction', label_ar: 'تفاعل تحسسي', default_ctas: 5, specific_modifiers: [{ modifier: 'Airway Compromise', ctas: 1 }, { modifier: 'Severe Bilateral Lip or Tongue Swelling', ctas: 1 }, { modifier: 'Previous severe reaction', ctas: 2 }, { modifier: 'Hayfever causing nasal congestion', ctas: 5 }] },
      wheezing: { label_en: 'Wheezing', label_ar: 'صفير', default_ctas: 3, specific_modifiers: [{ modifier: 'Wheezing no other complaints', ctas: 3 }] },
    }
  },
  NEUROLOGY: {
    color: '#0000CC', label_ar: 'الجهاز العصبي', label_en: 'Neurology',
    complaints: {
      altered_loc: { label_en: 'Altered Level of Consciousness', label_ar: 'اضطراب مستوى الوعي', default_ctas: 3, specific_modifiers: [{ modifier: 'With Confirmed or Suspected Overdose', ctas: 1 }, { modifier: 'Sudden change of LOC with Fever', ctas: 2 }, { modifier: 'BS < 4 mmol/L, Symptomatic', ctas: 2 }] },
      seizure: { label_en: 'Seizures', label_ar: 'نوبات تشنجية', default_ctas: 3, specific_modifiers: [{ modifier: 'Actively seizing', ctas: 1 }, { modifier: 'Postictal', ctas: 2 }, { modifier: 'Resolved, normal level of alertness', ctas: 3 }] },
      stroke_cva: { label_en: 'Symptoms of CVA/Stroke', label_ar: 'أعراض السكتة الدماغية', default_ctas: 3, specific_modifiers: [{ modifier: 'Wake Up Stroke or Within Therapeutic Window', ctas: 2 }, { modifier: 'Outside the Therapeutic Window or Resolved', ctas: 3 }], time_critical: true },
      headache: { label_en: 'Headache', label_ar: 'صداع', default_ctas: 5, specific_modifiers: [{ modifier: 'Sudden, Severe, Worst Ever Headache', ctas: 2 }, { modifier: 'Visual Acuity Disturbance +/- Eye Pain', ctas: 2 }, { modifier: 'Chronic or Recurring Headache', ctas: 5 }] },
      confusion: { label_en: 'Confusion', label_ar: 'ارتباك وتشوش', default_ctas: 3, specific_modifiers: [{ modifier: 'Acute Confusion', ctas: 2 }, { modifier: 'Risk of Flight or Safety Risk', ctas: 2 }, { modifier: 'Acute, No Headache', ctas: 3 }] },
    }
  },
  GENERAL: {
    color: '#33AA33', label_ar: 'عام', label_en: 'General',
    complaints: {
      fever: { label_en: 'Fever', label_ar: 'حمى', default_ctas: 4, specific_modifiers: [{ modifier: 'Petechial Rash', ctas: 2 }, { modifier: 'Looks well', ctas: 4 }, { modifier: 'Recent History of Fever Reported', ctas: 4 }] },
      hyperglycemia: { label_en: 'Hyperglycemia', label_ar: 'ارتفاع السكر', default_ctas: 3, specific_modifiers: [{ modifier: 'BS>14 mmol/L, Symptomatic', ctas: 2 }, { modifier: 'BS>14 mmol/L, Asymptomatic', ctas: 3 }] },
      hypoglycemia: { label_en: 'Hypoglycemia', label_ar: 'انخفاض السكر', default_ctas: 3, specific_modifiers: [{ modifier: 'BS < 4 mmol/L, Symptomatic', ctas: 2 }, { modifier: 'BS<4 mmol/L and Symptomatic Child > 1 yr', ctas: 2 }, { modifier: 'BS < 4 mmol/L, Asymptomatic', ctas: 3 }] },
      general_weakness: { label_en: 'General Weakness', label_ar: 'ضعف عام', default_ctas: 4, specific_modifiers: [{ modifier: 'Severe Dehydration', ctas: 1 }, { modifier: 'Atypical Cardiac Presentation', ctas: 2 }, { modifier: 'Moderate Dehydration', ctas: 2 }, { modifier: 'Acute Inability to Ambulate', ctas: 3 }, { modifier: 'Mild Dehydration', ctas: 3 }, { modifier: 'Chronic Weakness', ctas: 4 }] },
      newly_born: { label_en: 'Newly Born', label_ar: 'مولود جديد', default_ctas: 2, specific_modifiers: [{ modifier: 'Newly Born', ctas: 2 }] },
    }
  },
  GASTROINTESTINAL: {
    color: '#FF99CC', label_ar: 'الجهاز الهضمي', label_en: 'Gastrointestinal',
    complaints: {
      abdominal_pain: { label_en: 'Abdominal Pain', label_ar: 'ألم بطني', default_ctas: 5, specific_modifiers: [{ modifier: 'Chronic, mild abdominal pain', ctas: 5 }] },
      vomiting_nausea: { label_en: 'Vomiting and/or Nausea', label_ar: 'تقيؤ و/أو غثيان', default_ctas: 5, specific_modifiers: [{ modifier: 'Severe Dehydration', ctas: 1 }, { modifier: 'Active or Significant Hematemesis', ctas: 2 }, { modifier: 'Moderate Dehydration', ctas: 2 }, { modifier: 'Intractable Vomiting in Pregnancy', ctas: 3 }, { modifier: 'Mild Dehydration', ctas: 3 }, { modifier: 'Chronic Vomiting and/or Nausea', ctas: 5 }] },
      diarrhea: { label_en: 'Diarrhea', label_ar: 'إسهال', default_ctas: 5, specific_modifiers: [{ modifier: 'Severe dehydration', ctas: 1 }, { modifier: 'Moderate dehydration', ctas: 2 }, { modifier: 'Uncontrolled bloody diarrhea', ctas: 3 }, { modifier: 'Mild dehydration', ctas: 3 }, { modifier: 'Potential for dehydration', ctas: 4 }, { modifier: 'Chronic diarrhea, normal VS', ctas: 5 }] },
      blood_in_stools: { label_en: 'Blood in Stools/Melena', label_ar: 'دم في البراز/ميلينا', default_ctas: 4, specific_modifiers: [{ modifier: 'Large amount melena or rectal bleeding', ctas: 2 }, { modifier: 'Active and significant bloody diarrhea', ctas: 2 }, { modifier: 'On-going events of melena rectal bleeding', ctas: 3 }, { modifier: 'History of rectal bleeding, small amount', ctas: 4 }] },
    }
  },
  GENITOURINARY: {
    color: '#009999', label_ar: 'الجهاز البولي التناسلي', label_en: 'Genitourinary',
    complaints: {
      urinary_retention: { label_en: 'Urinary Retention', label_ar: 'احتباس بولي', default_ctas: 4, specific_modifiers: [{ modifier: 'Post-operative, unable to void', ctas: 2 }, { modifier: 'Unable to void, with distress', ctas: 3 }, { modifier: 'Urinary retention', ctas: 4 }] },
      uti: { label_en: 'UTI Complaints', label_ar: 'أعراض التهاب المسالك البولية', default_ctas: 5, specific_modifiers: [{ modifier: 'UTI Complaints with Fever', ctas: 3 }, { modifier: 'With back or flank pain', ctas: 3 }, { modifier: 'UTI Complaints/Symptoms', ctas: 5 }] },
    }
  },
  ORTHOPEDIC: {
    color: '#6600CC', label_ar: 'العظام والمفاصل', label_en: 'Orthopedic',
    complaints: {
      back_pain: { label_en: 'Back Pain', label_ar: 'ألم الظهر', default_ctas: 5, specific_modifiers: [{ modifier: 'History of AAA with New Symptoms', ctas: 2 }, { modifier: 'Neuro deficit +/- Bowel, Bladder Problems', ctas: 2 }, { modifier: 'History of AAA', ctas: 3 }] },
      upper_extremity_injury: { label_en: 'Upper Extremity Injury', label_ar: 'إصابة الطرف العلوي', default_ctas: 5, specific_modifiers: [{ modifier: 'Tourniquet Occluded Limb', ctas: 1 }, { modifier: 'Neurovascular Compromise', ctas: 2 }, { modifier: 'Open Fracture', ctas: 2 }, { modifier: 'Tight Cast with Neurovascular Compromise', ctas: 2 }, { modifier: 'Obvious Deformity', ctas: 3 }, { modifier: 'Tight Cast with Paresthesia', ctas: 3 }] },
      lower_extremity_injury: { label_en: 'Lower Extremity Injury', label_ar: 'إصابة الطرف السفلي', default_ctas: 5, specific_modifiers: [{ modifier: 'Tourniquet Occluded Limb', ctas: 1 }, { modifier: 'Neurovascular Compromise', ctas: 2 }, { modifier: 'Open Fracture', ctas: 2 }, { modifier: 'With Neurovascular Changes', ctas: 2 }, { modifier: 'Obvious Deformity', ctas: 3 }] },
      amputation: { label_en: 'Amputation', label_ar: 'بتر', default_ctas: 3, specific_modifiers: [{ modifier: 'Traumatic Amputation of an Extremity', ctas: 1 }, { modifier: 'Traumatic Amputation of a Digit or Partial Digit', ctas: 2 }, { modifier: 'With Open Fracture', ctas: 2 }, { modifier: 'Tip of Finger or Toe Amputation with Controlled Bleeding', ctas: 3 }] },
    }
  },
  MENTAL_HEALTH: {
    color: '#CCAA00', label_ar: 'الصحة النفسية', label_en: 'Mental Health',
    complaints: {
      violent_homicidal: { label_en: 'Violent/Homicidal Behaviour', label_ar: 'سلوك عنيف/قتالي', default_ctas: 3, specific_modifiers: [{ modifier: 'Imminent Harm to Self or Others', ctas: 1 }, { modifier: 'Specific Plan(s) to do harm', ctas: 1 }, { modifier: 'Uncertain Flight or Safety Risk', ctas: 2 }, { modifier: 'Violent Ideation, No Plan', ctas: 3 }] },
      depression_suicidal: { label_en: 'Depression/Suicidal/Self-Harm', label_ar: 'اكتئاب/أفكار انتحارية', default_ctas: 4, specific_modifiers: [{ modifier: 'Active suicidal intent', ctas: 2 }, { modifier: 'Attempted suicide or clear plan', ctas: 2 }, { modifier: 'Uncertain flight or safety risk', ctas: 2 }, { modifier: 'Suicidal ideation, no plan', ctas: 3 }, { modifier: 'Depressed, no suicidal ideation', ctas: 4 }] },
      anxiety_crisis: { label_en: 'Anxiety/Situational Crisis', label_ar: 'قلق/أزمة ظرفية', default_ctas: 4, specific_modifiers: [{ modifier: 'Severe Agitation or Uncontrolled Behaviour', ctas: 1 }, { modifier: 'Severe anxiety', ctas: 2 }, { modifier: 'Uncertain Flight or Safety Risk', ctas: 2 }, { modifier: 'Moderate Anxiety/Agitation', ctas: 3 }, { modifier: 'Mild Anxiety/Agitation', ctas: 4 }] },
    }
  },
  OB_GYN: {
    color: '#3333CC', label_ar: 'النساء والولادة', label_en: 'OB-GYN',
    complaints: {
      vaginal_bleed: { label_en: 'Vaginal Bleed', label_ar: 'نزيف مهبلي', default_ctas: 4, specific_modifiers: [{ modifier: 'Heavy Vaginal Bleeding +/- Pregnancy', ctas: 2 }, { modifier: 'With Recent High Risk Mechanism of Injury', ctas: 2 }, { modifier: 'Vaginal Bleeding - Normal VS', ctas: 3 }, { modifier: 'Vaginal Bleeding - Minor/Spotting', ctas: 4 }] },
      pregnancy_over_20: { label_en: 'Pregnancy Issues > 20 weeks', label_ar: 'مشاكل الحمل > 20 أسبوع', default_ctas: 4, specific_modifiers: [{ modifier: 'Active Vaginal Bleeding', ctas: 1 }, { modifier: 'Actively Seizing or Postictal', ctas: 1 }, { modifier: 'Decreased Fetal Movement', ctas: 1 }, { modifier: 'No Fetal Movement', ctas: 1 }, { modifier: 'Penetrating Trauma to the Abdomen', ctas: 1 }, { modifier: 'Presenting Fetal Parts or Prolapsed Cord', ctas: 1 }, { modifier: 'Active Labor (Contractions <= 5 min.)', ctas: 2 }, { modifier: 'Decreased Fetal Movement', ctas: 2 }, { modifier: 'Hypertension SBP > 160 or DBP > 100', ctas: 2 }] },
    }
  },
  SKIN: {
    color: '#CC66FF', label_ar: 'الجلد', label_en: 'Skin',
    complaints: {
      burn: { label_en: 'Burn', label_ar: 'حروق', default_ctas: 5, specific_modifiers: [{ modifier: 'Airway Burn, Signs of Inhalation Injury', ctas: 1 }, { modifier: 'Burn >25% BSA', ctas: 2 }, { modifier: 'Partial/Full Thickness to Hands, Feet, Face, or Perineum', ctas: 2 }, { modifier: 'Burn 5-25% BSA', ctas: 3 }, { modifier: 'Burn <5% BSA full, <10% partial thickness', ctas: 4 }, { modifier: 'Painless Mild Burn', ctas: 5 }] },
      rash: { label_en: 'Rash', label_ar: 'طفح جلدي', default_ctas: 5, specific_modifiers: [{ modifier: 'Facial Cellulitis, Particularly Periorbital Area', ctas: 2 }, { modifier: 'Purpuric or Petechial Rash (Appears Unwell)', ctas: 2 }, { modifier: 'Purpuric or Petechial Rash (Appears Well)', ctas: 3 }, { modifier: 'Localized Cellulitis', ctas: 4 }, { modifier: 'Localized Rash, No Other Symptoms', ctas: 5 }] },
      laceration: { label_en: 'Laceration/Puncture', label_ar: 'تمزق/ثقب', default_ctas: 5, specific_modifiers: [{ modifier: 'With Full Degloving Injury', ctas: 1 }, { modifier: 'Neurovascular Compromise', ctas: 2 }, { modifier: 'With High Mechanism of Injury', ctas: 2 }, { modifier: 'With Open Fracture', ctas: 2 }, { modifier: 'Active Bleeding', ctas: 3 }, { modifier: 'Sutures Required', ctas: 4 }, { modifier: 'Bleeding Resolved/Controlled', ctas: 4 }, { modifier: 'No Sutures Required', ctas: 5 }] },
    }
  },
  ENVIRONMENTAL: {
    color: '#FF6600', label_ar: 'البيئية', label_en: 'Environmental',
    complaints: {
      heat_related: { label_en: 'Heat Related Issue', label_ar: 'مشكلة حرارية', default_ctas: 4, specific_modifiers: [{ modifier: 'No evidence of sweating', ctas: 1 }, { modifier: 'Severe dehydration', ctas: 1 }, { modifier: 'Temperature > 41°C', ctas: 1 }, { modifier: 'Moderate dehydration', ctas: 2 }, { modifier: 'Temperature 39°-41°C', ctas: 2 }, { modifier: 'Ongoing heat cramps', ctas: 3 }, { modifier: 'Mild dehydration', ctas: 3 }, { modifier: 'Heat cramps resolving, well hydrated', ctas: 4 }] },
      chemical_exposure: { label_en: 'Chemical Exposure', label_ar: 'تعرض كيميائي', default_ctas: 2, specific_modifiers: [{ modifier: 'Major Burn > 25% BSA', ctas: 1 }, { modifier: 'Chemical Exposure', ctas: 2 }, { modifier: 'Major Burn - hands, feet, groin or face', ctas: 2 }] },
    }
  },
};

// ── CTAS level colors ─────────────────────────────────────────────────────────
export const CTAS_CONFIG = {
  1: { ar: 'إنعاش', en: 'Resuscitation', wait_ar: 'فوري', wait_en: 'Immediate', wait_min: 0, hex: '#E24B4A' },
  2: { ar: 'طارئ', en: 'Emergent', wait_ar: '١٥ دقيقة', wait_en: '15 minutes', wait_min: 15, hex: '#EF9F27' },
  3: { ar: 'عاجل', en: 'Urgent', wait_ar: '٣٠ دقيقة', wait_en: '30 minutes', wait_min: 30, hex: '#0F6E56' },
  4: { ar: 'أقل إلحاحاً', en: 'Less Urgent', wait_ar: '٦٠ دقيقة', wait_en: '60 minutes', wait_min: 60, hex: '#378ADD' },
  5: { ar: 'غير عاجل', en: 'Non-Urgent', wait_ar: '١٢٠ دقيقة', wait_en: '120 minutes', wait_min: 120, hex: '#888780' },
};

// matchComplaint lives in resolveChiefComplaint.js (scored resolver) to avoid
// silent first-substring mapping. Re-exported from package index.