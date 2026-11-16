export function BrandLogo({ className = "w-6 h-6" }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" className={className}>
      <rect width="64" height="64" rx="14" fill="#3B4A9E"/>
      <path d="M24 20 H44 M24 20 V44 M24 32 H38" stroke="#FFFFFF" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
      <circle cx="44" cy="44" r="4" fill="#4FD1C1"/>
    </svg>
  )
}
