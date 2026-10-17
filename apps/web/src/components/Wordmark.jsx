/** TriagePulse wordmark: a single ECG spike and the name, in ink. */
export function PulseMark({ className = 'w-8 h-6', color = 'currentColor', strokeWidth = 5 }) {
  return (
    <svg viewBox="0 0 56 40" className={className} aria-hidden="true">
      <path
        d="M2 22 H16 L21 8 L29 34 L34 18 L38 22 H54"
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function Wordmark({ size = 'md', inverse = false }) {
  const text = size === 'lg' ? 'text-4xl' : size === 'sm' ? 'text-lg' : 'text-xl';
  const mark = size === 'lg' ? 'w-12 h-9' : size === 'sm' ? 'w-6 h-5' : 'w-8 h-6';
  return (
    <span dir="ltr" className={`inline-flex items-center gap-2 ${inverse ? 'text-white' : 'text-ink'}`}>
      <PulseMark className={mark} />
      <span className={`${text} font-semibold tracking-tight`}>TriagePulse</span>
    </span>
  );
}
