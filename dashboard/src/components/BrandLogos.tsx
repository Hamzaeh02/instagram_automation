import type { ComponentType } from "react"

type LogoProps = { className?: string }

export function YouTubeBrand({ className }: LogoProps) {
  return (
    <svg viewBox="0 0 28 20" className={className} role="img" aria-label="YouTube">
      <path
        d="M27.4 3.1A3.5 3.5 0 0 0 25 .6C22.8 0 14 0 14 0S5.2 0 3 .6A3.5 3.5 0 0 0 .6 3.1C0 5.3 0 10 0 10s0 4.7.6 6.9A3.5 3.5 0 0 0 3 19.4c2.2.6 11 .6 11 .6s8.8 0 11-.6a3.5 3.5 0 0 0 2.4-2.5c.6-2.2.6-6.9.6-6.9s0-4.7-.6-6.9Z"
        fill="#FF0000"
      />
      <path d="M11.2 14.3 18.5 10l-7.3-4.3v8.6Z" fill="#fff" />
    </svg>
  )
}

export function InstagramBrand({ className }: LogoProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} role="img" aria-label="Instagram">
      <defs>
        <radialGradient id="ig-grad" cx="30%" cy="107%" r="150%">
          <stop offset="0%" stopColor="#fdf497" />
          <stop offset="5%" stopColor="#fdf497" />
          <stop offset="45%" stopColor="#fd5949" />
          <stop offset="60%" stopColor="#d6249f" />
          <stop offset="90%" stopColor="#285AEB" />
        </radialGradient>
      </defs>
      <rect width="24" height="24" rx="6" fill="url(#ig-grad)" />
      <rect x="5" y="5" width="14" height="14" rx="4" fill="none" stroke="#fff" strokeWidth="1.8" />
      <circle cx="12" cy="12" r="3.3" fill="none" stroke="#fff" strokeWidth="1.8" />
      <circle cx="16.3" cy="7.7" r="1.05" fill="#fff" />
    </svg>
  )
}

export function FacebookBrand({ className }: LogoProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} role="img" aria-label="Facebook">
      <circle cx="12" cy="12" r="12" fill="#1877F2" />
      <path
        d="M15.6 7.6h-1.7c-1 0-1.3.6-1.3 1.3v1.6h2.9l-.4 2.9h-2.5V24h-3V13.4H7.2v-2.9h2.4V8.6c0-2.4 1.4-3.7 3.6-3.7 1 0 2 .2 2.4.2v2.5Z"
        fill="#fff"
      />
    </svg>
  )
}

export function TikTokBrand({ className }: LogoProps) {
  const note =
    "M16.6 5.8a3.9 3.9 0 0 1-3-3.3V2h-2.8v11.3a2.4 2.4 0 1 1-1.7-2.3V8.1a5.2 5.2 0 1 0 4.5 5.2V7.6a6.7 6.7 0 0 0 3.9 1.2V6a3.9 3.9 0 0 1-.9-.2Z"
  return (
    <svg viewBox="0 0 24 24" className={className} role="img" aria-label="TikTok">
      <rect width="24" height="24" rx="6" fill="#010101" />
      <g transform="translate(1.6 2.4) scale(0.86)">
        <path d={note} fill="#25F4EE" transform="translate(-0.7 -0.7)" />
        <path d={note} fill="#FE2C55" transform="translate(0.7 0.7)" />
        <path d={note} fill="#fff" />
      </g>
    </svg>
  )
}

export function LinkedInBrand({ className }: LogoProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} role="img" aria-label="LinkedIn">
      <rect width="24" height="24" rx="5" fill="#0A66C2" />
      <circle cx="7.1" cy="7.2" r="1.7" fill="#fff" />
      <rect x="5.6" y="9.8" width="3" height="8.6" fill="#fff" />
      <path
        d="M10.8 9.8h2.9v1.2c.4-.8 1.4-1.4 2.9-1.4 3 0 3.6 1.9 3.6 4.5v4.3h-3v-3.8c0-.9 0-2.1-1.3-2.1s-1.5 1-1.5 2v3.9h-3.6V9.8Z"
        fill="#fff"
      />
    </svg>
  )
}

export function XBrand({ className }: LogoProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} role="img" aria-label="X">
      <rect width="24" height="24" rx="6" fill="#000" />
      <path
        d="M16.2 5.5h2.2l-4.8 5.5 5.7 7.5h-4.5l-3.5-4.5-4 4.5H5.1l5.2-5.9-5.4-7.1h4.6l3.1 4.1 3.6-4.1Zm-.8 11.7h1.2L8.7 6.7H7.4l8 10.5Z"
        fill="#fff"
      />
    </svg>
  )
}

export const BRAND_PLATFORMS: { key: string; label: string; logo: ComponentType<LogoProps> }[] = [
  { key: "youtube", label: "YouTube", logo: YouTubeBrand },
  { key: "instagram", label: "Instagram", logo: InstagramBrand },
  { key: "tiktok", label: "TikTok", logo: TikTokBrand },
  { key: "facebook", label: "Facebook", logo: FacebookBrand },
  { key: "linkedin", label: "LinkedIn", logo: LinkedInBrand },
  { key: "x", label: "X", logo: XBrand },
]
