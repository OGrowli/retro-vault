import { useState } from 'react'
import type { Game } from '@retro-vault/shared'

interface Props {
  game: Game
  focused: boolean
  label?: string
  size?: 'sm' | 'lg'
  onClick?: (game: Game) => void
}

export function GameCard({ game, focused, label, size = 'sm', onClick }: Props) {
  const [imgLoaded, setImgLoaded] = useState(false)
  const isLg = size === 'lg'

  return (
    <div
      data-focusable="true"
      onClick={() => onClick?.(game)}
      className={[
        'relative flex-shrink-0 rounded-xl overflow-hidden cursor-pointer',
        'bg-vault-card',
        isLg ? 'w-56 h-72' : 'w-44 h-60',
        focused ? 'ring-4 ring-vault-accent-bright' : 'ring-0',
      ].join(' ')}
    >
      {game.box_art_path ? (
        <>
          {!imgLoaded && (
            <div className="absolute inset-0 bg-vault-surface animate-pulse" />
          )}
          <img
            src={game.box_art_path}
            alt={game.name}
            className={[
              'w-full object-cover transition-opacity duration-200',
              isLg ? 'h-56' : 'h-48',
              imgLoaded ? 'opacity-100' : 'opacity-0',
            ].join(' ')}
            loading="lazy"
            onLoad={() => setImgLoaded(true)}
          />
        </>
      ) : (
        <div className={`w-full bg-vault-surface flex flex-col items-center justify-center gap-2 ${isLg ? 'h-56' : 'h-48'}`}>
          <svg width="48" height="48" viewBox="0 0 48 48" fill="none" className="opacity-20">
            <rect x="4" y="14" width="40" height="24" rx="12" stroke="white" strokeWidth="2"/>
            <rect x="12" y="23" width="8" height="2.5" rx="1.25" fill="white"/>
            <rect x="14.75" y="20.25" width="2.5" height="8" rx="1.25" fill="white"/>
            <circle cx="31" cy="22" r="2" fill="white"/>
            <circle cx="35" cy="26" r="2" fill="white"/>
            <line x1="17" y1="14" x2="17" y2="10" stroke="white" strokeWidth="2" strokeLinecap="round"/>
            <line x1="31" y1="14" x2="31" y2="10" stroke="white" strokeWidth="2" strokeLinecap="round"/>
          </svg>
          <span className="text-vault-muted text-xs uppercase tracking-widest">{game.system}</span>
        </div>
      )}

      <div className="p-2">
        <p className="text-white text-sm font-semibold uppercase tracking-wide truncate leading-tight">
          {game.name}
        </p>
        <p className="text-vault-muted text-xs mt-0.5 uppercase tracking-wider">{game.system}</p>
        {label && (
          <span className="mt-1 inline-block bg-vault-accent text-white text-xs font-bold uppercase tracking-wide px-1.5 py-0.5 rounded">
            {label}
          </span>
        )}
      </div>

      {focused && (
        <div className="absolute inset-0 ring-2 ring-inset ring-vault-accent rounded-xl pointer-events-none" />
      )}
    </div>
  )
}
