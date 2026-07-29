const STEPS = [
  { num: 1, ar: 'الفرز البصري', en: 'Visual' },
  { num: 2, ar: 'التسجيل', en: 'Reg' },
  { num: 3, ar: 'CTAS', en: 'CTAS' },
];

export default function JourneyProgress({ currentStep }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm px-4 py-3">
      <div className="flex items-center justify-center gap-0">
        {STEPS.map((step, i) => (
          <div key={step.num} className="flex items-center">
            <div className="flex flex-col items-center">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-black border-2 transition-all ${
                step.num < currentStep
                  ? 'bg-red-600 border-red-600 text-white'
                  : step.num === currentStep
                  ? 'bg-white border-red-600 text-red-600'
                  : 'bg-white border-slate-300 text-slate-400'
              }`}>
                {step.num < currentStep ? '✓' : step.num}
              </div>
              <p className={`text-xs font-bold mt-1 whitespace-nowrap ${
                step.num === currentStep ? 'text-red-600' : step.num < currentStep ? 'text-red-400' : 'text-slate-400'
              }`}>
                {step.ar}
              </p>
              <p className="text-xs text-slate-300">{step.en}</p>
            </div>
            {i < STEPS.length - 1 && (
              <div className={`w-12 h-0.5 mb-5 mx-1.5 ${step.num < currentStep ? 'bg-red-500' : 'bg-slate-200'}`} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}