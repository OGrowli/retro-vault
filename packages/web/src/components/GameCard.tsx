import { useState } from 'react'
import type { Game } from '@retro-vault/shared'

interface Props {
  game: Game
  focused: boolean
  label?: string
  size?: 'sm' | 'lg'
}

export function GameCard({ game, focused, label, size = 'sm' }: Props) {
  const [imgLoaded, setImgLoaded] = useState(false)
  const isLg = size === 'lg'

  return (
    <div
      data-focusable="true"
      className={[
        'relative flex-shrink-0 rounded-xl overflow-hidden cursor-pointer',
        'transition-transform duration-150 motion-reduce:transition-none',
        'bg-vault-card',
        isLg ? 'w-56 h-72' : 'w-44 h-60',
        focused
          ? 'ring-2 ring-vault-accent scale-105 motion-reduce:scale-100'
          : 'ring-0 scale-100',
      ].join(' ')}
    >
      {game.box_art_path ? (
        <>
          {!imgLoaded && (
            <div className="absolute inset-0 bg-vault-muted animate-pulse" />
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
        <div className={`w-full bg-vault-surface flex items-center justify-center ${isLg ? 'h-56' : 'h-48'}`}>
          <span className="text-vault-muted text-xs uppercase tracking-widest">{game.system}</span>
        </div>
      )}

      <div className="p-2">
        <p className="text-white text-xs font-semibold uppercase tracking-wide truncate leading-tight">
          {game.name}
        </p>
        <p className="text-vault-muted text-xs mt-0.5 uppercase tracking-wider">{game.system}</p>
        {label && (
          <span className="mt-1 inline-block bg-vault-accent text-white text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded">
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
