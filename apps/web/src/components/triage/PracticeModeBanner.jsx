export function PracticeModeBanner() {
  return (
    <p role="status" className="m-0 border-2 border-ink rounded-xl px-4 py-3 text-sm font-semibold">
      وضع التدريب: يمكنك استخدام الفرز ورؤية مستوى CTAS، لكن الحفظ للممرض / فني الرعاية والمسؤول فقط.
      <span className="block font-normal" dir="ltr">Practice mode: you can use triage and see the CTAS level, but only Nurse / PCT and admin can save.</span>
    </p>
  );
}
