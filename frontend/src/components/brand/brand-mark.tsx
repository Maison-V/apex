export default function BrandMark({ size = 22 }: { size?: number }) {
  return (
    <div className="flex items-center gap-2.5">
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M12 2L2 7v10l10 5 10-5V7L12 2z" stroke="#7c5cff" strokeWidth="1.5" fill="none" />
        <path d="M12 6L6 9v6l6 3 6-3V9l-6-3z" fill="#7c5cff" fillOpacity="0.14" stroke="#7c5cff" strokeWidth="1" />
        <circle cx="12" cy="12" r="2" fill="#7c5cff" />
      </svg>
      <span className="text-sm font-semibold tracking-tight text-text-primary">
        APEX<span className="text-text-muted font-normal"> CELESTIAL</span>
      </span>
    </div>
  );
}