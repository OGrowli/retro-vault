// Shared visual primitives for the "terminal-meets-PS5" design language.
// Two palettes: `vault` (console — dark, cyan primary, magenta selection bar)
// and `idg` (idGames/Doom — warm, orange primary, gold selection bar).
import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import type { RomKind } from '@retro-vault/shared'

export type Mode = 'vault' | 'idg'

// ---- Marquee title -------------------------------------------------------
// List titles run past the width of their row and get clipped. On the focused
// row, after a short dwell, slide the text so its tail is readable, then hold
// and slide back. Only ever one row animates, and it animates transform only —
// composited, no layout or paint per frame, which is what makes it affordable
// on the Pi.
//
// Deliberately NOT gated on motion-reduce: the kiosk starts Chromium with
// --force-prefers-reduced-motion (scripts/launch-chromium.sh), which is what
// switches the app's decorative transitions off. This one isn't decoration —
// it is the only way to read a clipped title on the device — so it has to run
// even there.
export function ScrollingTitle({
  text, focused, className = 'text-xl', wrap = 'flex-1 min-w-0',
}: { text: string; focused: boolean; className?: string; wrap?: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const [shift, setShift] = useState(0)

  useEffect(() => {
    setShift(0)
    if (!focused) return
    const el = ref.current
    if (!el) return
    const over = el.scrollWidth - el.clientWidth
    if (over <= 4) return
    const t = setTimeout(() => setShift(over), 700)
    return () => clearTimeout(t)
  }, [focused, text])

  // ~55px/s of travel, with the keyframe holds folded in.
  const duration = Math.round(shift * 18 + 1800)

  return (
    <span className={`${wrap} overflow-hidden`}>
      <span
        ref={ref}
        className={`block ${className} ${shift ? 'whitespace-nowrap animate-marquee' : 'truncate'}`}
        style={shift ? ({ '--mq-shift': `-${shift}px`, animationDuration: `${duration}ms` } as CSSProperties) : undefined}
      >
        {text}
      </span>
    </span>
  )
}

// ---- Flat selectable row -------------------------------------------------
// Selected = accent fill + dark ink text + a thick coloured left bar. Unselected
// rows keep a transparent 6px bar so text never shifts on focus. Instant, no ease.
export function rowClass(selected: boolean, mode: Mode = 'vault'): string {
  const base = 'flex items-center gap-6 px-6 py-3.5 border-l-[6px] cursor-pointer'
  if (!selected) return `${base} border-transparent`
  return mode === 'idg'
    ? `${base} bg-idg-fill text-idg-ink border-idg-gold`
    : `${base} bg-vault-accent-bright text-vault-ink border-vault-pink`
}

// The leading caret shown only on the focused row.
export function Caret({ selected, mode = 'vault' }: { selected: boolean; mode?: Mode }) {
  const color = mode === 'idg' ? 'text-idg-ink' : 'text-vault-ink'
  return (
    <span className={`w-6 flex-none text-2xl leading-none ${selected ? color : 'text-transparent'}`}>
      ▸
    </span>
  )
}

// ---- Mono label / breadcrumb --------------------------------------------
export function Breadcrumb({ children, mode = 'vault' }: { children: ReactNode; mode?: Mode }) {
  const c = mode === 'idg' ? 'text-idg-muted' : 'text-vault-muted'
  return (
    <div className={`font-mono text-[0.9rem] uppercase tracking-[0.14em] ${c}`}>{children}</div>
  )
}

// ---- Display title -------------------------------------------------------
export function Title({ children, className = '', mode = 'vault' }: { children: ReactNode; className?: string; mode?: Mode }) {
  const c = mode === 'idg' ? 'text-idg-text' : 'text-[#eaf0f8]'
  return (
    <h1 className={`font-display font-normal leading-[1.04] tracking-[-0.02em] ${c} ${className}`}>
      {children}
    </h1>
  )
}

// ---- Section header (label — hairline — count) --------------------------
export function SectionHeader({ label, meta, mode = 'vault' }: { label: ReactNode; meta?: ReactNode; mode?: Mode }) {
  const c = mode === 'idg' ? 'text-idg-muted' : 'text-vault-muted'
  const hair = mode === 'idg' ? 'bg-idg-text/10' : 'bg-[#eaf0f8]/10'
  return (
    <div className={`flex items-center gap-6 font-mono text-[0.9rem] uppercase tracking-[0.14em] ${c}`}>
      <span>{label}</span>
      <span className={`flex-1 h-px ${hair}`} />
      {meta && <span>{meta}</span>}
    </div>
  )
}

// A plain full-width hairline divider.
export function Rule({ mode = 'vault' }: { mode?: Mode }) {
  return <div className={`h-px ${mode === 'idg' ? 'bg-idg-text/15' : 'bg-[#eaf0f8]/15'}`} />
}

// ---- ROM kind badge ------------------------------------------------------
const KIND_TAG: Record<RomKind, { label: string; cls: string }> = {
  official: { label: 'official', cls: 'border-vault-accent-dim text-vault-accent' },
  translation: { label: 'translation', cls: 'border-vault-pink text-vault-pink-soft' },
  hack: { label: 'hack', cls: 'border-vault-pink text-vault-pink-soft' },
  prototype: { label: 'prototype', cls: 'border-purple-400 text-purple-300' },
  homebrew: { label: 'homebrew', cls: 'border-vault-muted text-vault-muted' },
}

// `dark` renders the on-fill variant (dark border, used inside a selected row).
export function KindTag({ kind, dark = false }: { kind: RomKind | undefined; dark?: boolean }) {
  const meta = KIND_TAG[kind ?? 'official'] ?? KIND_TAG.official
  return (
    <span
      className={[
        'flex-none font-mono text-[0.7rem] uppercase tracking-[0.1em] border rounded-[2px] px-2.5 py-0.5',
        dark ? 'border-vault-ink/40 text-vault-ink' : meta.cls,
      ].join(' ')}
    >
      {meta.label}
    </span>
  )
}

// A generic mono pill tag (idGames categories, misc labels).
export function Tag({ children, mode = 'vault', dark = false }: { children: ReactNode; mode?: Mode; dark?: boolean }) {
  const cls = dark
    ? mode === 'idg' ? 'border-idg-ink/40 text-idg-ink' : 'border-vault-ink/40 text-vault-ink'
    : mode === 'idg' ? 'border-idg-dim text-idg-accent' : 'border-vault-accent-dim text-vault-accent'
  return (
    <span className={`flex-none font-mono text-[0.7rem] uppercase tracking-[0.1em] border rounded-[2px] px-2.5 py-0.5 ${cls}`}>
      {children}
    </span>
  )
}

// ---- Region chip ---------------------------------------------------------
const REGION_CODE: Record<string, string> = {
  USA: 'us', Europe: 'eu', Japan: 'jp', World: 'wo',
  Australia: 'au', Spain: 'es', France: 'fr', Germany: 'de',
}
function regionCode(region: string | null): string {
  if (!region) return '··'
  return REGION_CODE[region] ?? region.slice(0, 2).toLowerCase()
}

export function RegionChip({ region, dark = false }: { region: string | null; dark?: boolean }) {
  return (
    <span
      className={[
        'w-14 flex-none text-center font-mono text-[0.68rem] uppercase tracking-[0.1em] border rounded-[2px] py-1',
        dark ? 'border-vault-ink/40 text-vault-ink' : 'border-[#eaf0f8]/28 text-[#eaf0f8]/72',
      ].join(' ')}
    >
      {regionCode(region)}
    </span>
  )
}

// ---- Controller hint bar -------------------------------------------------
export function HintBar({ hints, mode = 'vault' }: { hints: string[]; mode?: Mode }) {
  const c = mode === 'idg' ? 'text-idg-muted' : 'text-vault-muted'
  return (
    <div className={`flex gap-12 flex-wrap font-mono text-[0.9rem] uppercase tracking-[0.08em] ${c}`}>
      {hints.map((h, i) => <span key={i}>{h}</span>)}
    </div>
  )
}
