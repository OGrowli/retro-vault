import { useState } from 'react'
import { useGamepad } from '../hooks/useGamepad'
import { Glyph } from '../components/Glyph'
import { Clock } from '../components/Clock'

type Choice = 'doom' | 'retrovault'

interface Props {
  onChoose: (choice: Choice) => void
}

// First screen on launch — pick Doom or the normal RetroVault flow. Deliberately
// minimal and styled to match ProfileSelect so it reads as part of the app.
const CARDS: { key: Choice; title: string; subtitle: string; accent: string }[] = [
  { key: 'doom', title: 'DOOM', subtitle: 'Online servers · custom WADs', accent: '#b3202a' },
  { key: 'retrovault', title: 'RetroVault', subtitle: 'Your game library', accent: '#0070D1' },
]

export function Landing({ onChoose }: Props) {
  const [focus, setFocus] = useState(0)

  useGamepad((action) => {
    if (action === 'left') setFocus(i => Math.max(0, i - 1))
    if (action === 'right') setFocus(i => Math.min(CARDS.length - 1, i + 1))
    if (action === 'confirm') onChoose(CARDS[focus]!.key)
  }, true)

  return (
    <div className="fixed inset-0 bg-vault-bg flex flex-col items-center justify-center">
      <div className="absolute top-[3%] right-[5%]"><Clock /></div>

      <div className="mb-12 text-center">
        <h1 className="text-white text-4xl font-bold tracking-tight">Choose Mode</h1>
        <p className="text-vault-muted text-sm uppercase tracking-widest mt-2">Where to?</p>
      </div>

      <div className="flex gap-8 px-[5%]">
        {CARDS.map((card, i) => {
          const focused = focus === i
          return (
            <div
              key={card.key}
              onMouseEnter={() => setFocus(i)}
              onClick={() => onChoose(card.key)}
              className={[
                'w-72 h-56 rounded-2xl flex flex-col items-center justify-center gap-3 cursor-pointer',
                'border transition-transform duration-150 motion-reduce:transition-none',
                focused ? 'ring-4 ring-vault-accent-bright scale-[1.03] border-transparent' : 'border-vault-surface',
              ].join(' ')}
              style={{ background: `linear-gradient(160deg, ${card.accent}22, #14141c)` }}
            >
              <span
                className="text-4xl font-extrabold tracking-tight"
                style={{ color: focused ? '#fff' : card.accent }}
              >
                {card.title}
              </span>
              <span className={`text-xs uppercase tracking-widest ${focused ? 'text-white' : 'text-vault-muted'}`}>
                {card.subtitle}
              </span>
            </div>
          )
        })}
      </div>

      <p className="absolute bottom-8 text-vault-muted text-xs uppercase tracking-widest flex items-center gap-1.5">
        <Glyph type="cross" /> Select  ·  ← → Navigate
      </p>
    </div>
  )
}
