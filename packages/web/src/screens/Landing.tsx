import { useState } from 'react'
import { useGamepad } from '../hooks/useGamepad'
import { Clock } from '../components/Clock'
import { Breadcrumb, HintBar } from '../components/ui'
import retrovaultHero from '../assets/retrovault-hero.png'
import idgamesHero from '../assets/idgames-hero.png'

type Choice = 'doom' | 'retrovault'

interface Props {
  onChoose: (choice: Choice) => void
}

// First screen on launch — pick RetroVault or the idGames/Doom mode. The one
// screen where a bit of art earns its keep (seen once per session). Each block
// is a full-bleed hero; the focused one gets the magenta selection bar.
const CARDS: { key: Choice; title: string; subtitle: string; art: string }[] = [
  { key: 'retrovault', title: 'RetroVault', subtitle: 'your game library', art: retrovaultHero },
  { key: 'doom', title: 'idGames', subtitle: 'doom · custom wads', art: idgamesHero },
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
          <Clock />
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
                'flex-1 min-w-0 relative overflow-hidden cursor-pointer flex flex-col justify-end',
                'border-l-[6px]',
                focused ? 'border-vault-pink' : 'border-transparent',
              ].join(' ')}
              style={{ outline: focused ? '' : '1px solid rgba(234,240,248,0.14)' }}
            >
              <img
                src={card.art}
                alt={card.title}
                className={[
                  'absolute inset-0 w-full h-full object-cover',
                  focused ? '' : 'opacity-55 grayscale-[0.3]',
                ].join(' ')}
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
              <div className="relative p-10">
                <div className="font-display text-6xl tracking-[-0.02em] text-white">{card.title}</div>
                <div className="font-mono text-[0.95rem] uppercase tracking-[0.14em] text-white/70 mt-2">
                  {card.subtitle}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      <HintBar hints={['d-pad move', 'a confirm', 'start settings']} />
    </div>
  )
}
