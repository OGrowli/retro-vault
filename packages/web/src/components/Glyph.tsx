type GlyphType = 'cross' | 'circle' | 'square' | 'triangle'

const ICON_PATHS: Record<GlyphType, React.ReactNode> = {
  cross: <path d="M7 7L17 17M17 7L7 17" />,
  circle: <circle cx="12" cy="12" r="7" />,
  square: <rect x="6" y="6" width="12" height="12" rx="1.5" />,
  triangle: <polygon points="12,5 19,18 5,18" />,
}

export function Glyph({ type }: { type: GlyphType }) {
  return (
    <span className="inline-flex items-center justify-center w-[1.3em] h-[1.3em] rounded-full border border-current flex-shrink-0">
      <svg
        viewBox="0 0 24 24"
        className="w-[0.7em] h-[0.7em]"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {ICON_PATHS[type]}
      </svg>
    </span>
  )
}
