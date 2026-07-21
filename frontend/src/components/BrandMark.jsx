export default function BrandMark() {
  return (
    <div className="brand-mark">
      <svg className="brand-logo" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M12 2L2 7v10l10 5 10-5V7L12 2z" stroke="currentColor" strokeWidth="1.5" fill="none" />
        <path d="M12 6L6 9v6l6 3 6-3V9l-6-3z" fill="currentColor" fillOpacity="0.15" stroke="currentColor" strokeWidth="1" />
        <circle cx="12" cy="12" r="2" fill="currentColor" />
      </svg>
      <span>
        <span className="name-accent">APEX</span> CELESTIAL
      </span>
    </div>
  )
}
