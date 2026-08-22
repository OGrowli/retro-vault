import { useState } from 'react'
import { useGamepad } from '../hooks/useGamepad'
import { StatusBar } from '../components/StatusBar'
import { Breadcrumb, HintBar } from '../components/ui'

type Choice = 'doom' | 'retrovault'

interface Props {
  onChoose: (choice: Choice) => void
}

// First screen on launch — pick RetroVault or the idGames/Doom mode. The spec
// makes this the one screen where typographic personality earns its keep (seen
// once per session), so each mode is a large type block in its own palette; the
// focused one lights up with the magenta selection bar.
const CARDS: {
  key: Choice; title: string; subtitle: string
  bg: string; accent: string; wash: string
}[] = [
  { key: 'retrovault', title: 'RetroVault', subtitle: 'your game library', bg: '#12101c', accent: '#6fd3ff', wash: 'rgba(53,198,255,0.10)' },
  { key: 'doom', title: 'idGames', subtitle: 'doom · custom wads', bg: '#16100f', accent: '#ff8a3d', wash: 'rgba(255,107,26,0.10)' },
]

export function Landing({ onChoose }: Props) {
  const [focus, setFocus] = useState(0)

  useGamepad((action) => {
    if (action === 'left') setFocus(i => Math.max(0, i - 1))
    if (action === 'right') setFocus(i => Math.min(CARDS.length - 1, i + 1))
    if (action === 'confirm') onChoose(CARDS[focus]!.key)
  }, true)

  return (
    <div className="fixed inset-0 bg-vault-bg flex flex-col px-[5%] py-[3%] font-sans">
      <div className="flex items-center justify-between">
        <Breadcrumb>retrovault · pi 3b+ kiosk</Breadcrumb>
        <div className="flex items-center gap-8">
          <Breadcrumb>select mode</Breadcrumb>
          <StatusBar />
        </div>
      </div>

      <div className="flex-1 flex gap-14 py-10 min-h-0">
        {CARDS.map((card, i) => {
          const focused = focus === i
          return (
            <div
              key={card.key}
              onMouseEnter={() => setFocus(i)}
              onClick={() => onChoose(card.key)}
              className={[
                'flex-1 min-w-0 relative overflow-hidden cursor-pointer flex flex-col justify-end p-12',
                'border-l-[6px] transition-opacity duration-150 motion-reduce:transition-none',
                focused ? 'border-vault-pink' : 'border-transparent opacity-60',
              ].join(' ')}
              style={{
                background: focused ? `${card.wash}, ${card.bg}` : card.bg,
                backgroundBlendMode: 'normal',
                outline: focused ? `2px solid ${card.accent}` : '1px solid rgba(234,240,248,0.14)',
                outlineOffset: '-2px',
              }}
            >
              {/* oversized watermark initial for a little personality */}
              <div
                className="absolute -top-10 -right-6 font-display leading-none pointer-events-none select-none"
                style={{ fontSize: '22rem', color: card.accent, opacity: focused ? 0.12 : 0.05 }}
              >
                {card.title.charAt(0)}
              </div>
              <div className="relative">
                <div className="font-mono text-[0.95rem] uppercase tracking-[0.16em] mb-3" style={{ color: card.accent }}>
                  {focused ? '▸ ' : ''}{card.subtitle}
                </div>
                <div className="font-display text-8xl tracking-[-0.02em] text-white leading-none">{card.title}</div>
              </div>
            </div>
          )
        })}
      </div>

      <HintBar hints={['d-pad move', 'a confirm', 'start settings']} />
    </div>
  )
}
