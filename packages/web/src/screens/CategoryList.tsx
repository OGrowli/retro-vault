import { useState, useCallback } from 'react'
import type { Game } from '@retro-vault/shared'
import { bgVariant } from '../api/client'
import { useGamepad } from '../hooks/useGamepad'
import { VirtualGrid, GRID_COLS } from '../components/VirtualGrid'
import { Glyph } from '../components/Glyph'

interface Props {
  title: string
  games: Game[]
  onGameSelect: (game: Game) => void
  onBack: () => void
  inputActive?: boolean
}

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v))

export function CategoryList({ title, games, onGameSelect, onBack, inputActive = true }: Props) {
  const [row, setRow] = useState(0)
  const [col, setCol] = useState(0)
  const [bgSrc, setBgSrc] = useState<string | null>(null)

  const totalRows = Math.max(1, Math.ceil(games.length / GRID_COLS))

  // Last row may be partial — clamp horizontal movement to real cards.
  const maxColForRow = useCallback((r: number) => {
    if (r < totalRows - 1) return GRID_COLS - 1
    const lastCount = games.length - (totalRows - 1) * GRID_COLS
    return Math.max(0, lastCount - 1)
  }, [games.length, totalRows])

  useGamepad((action) => {
    if (action === 'back') { onBack(); return }
    if (action === 'confirm') {
      const g = games[row * GRID_COLS + col]
      if (g) onGameSelect(g)
      return
    }
    if (action === 'left') setCol(clamp(col - 1, 0, maxColForRow(row)))
    if (action === 'right') setCol(clamp(col + 1, 0, maxColForRow(row)))
    if (action === 'up') {
      const nr = clamp(row - 1, 0, totalRows - 1)
      setRow(nr)
      setCol(Math.min(col, maxColForRow(nr)))
    }
    if (action === 'down') {
      const nr = clamp(row + 1, 0, totalRows - 1)
      setRow(nr)
      setCol(Math.min(col, maxColForRow(nr)))
    }
  }, inputActive)

  const onFocusGame = useCallback((g: Game) => {
    setBgSrc(g.box_art_path ? bgVariant(g.box_art_path) : null)
  }, [])

  return (
    <div className="fixed inset-0 bg-vault-bg overflow-hidden">
      <div
        className="absolute inset-0 transition-opacity duration-500 pointer-events-none motion-reduce:transition-none"
        style={{
          backgroundImage: bgSrc ? `url(${bgSrc})` : 'none',
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          opacity: bgSrc ? 0.25 : 0,
        }}
      />

      <div className="relative h-full overflow-y-auto" style={{ scrollbarWidth: 'none' }}>
        <header className="px-[5%] pt-[3%] pb-2 flex items-center gap-3">
          <button
            onClick={onBack}
            className="p-2 rounded-lg text-vault-muted hover:text-white transition-colors"
            title="Back (Circle / Esc)"
            aria-label="Back"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 12H5" />
              <path d="m12 19-7-7 7-7" />
            </svg>
          </button>
          <h1 className="text-white text-2xl font-bold tracking-tight">{title}</h1>
          <span className="text-vault-muted text-sm font-medium">{games.length}</span>
        </header>

        <VirtualGrid
          games={games}
          focusedRow={row}
          focusedCol={col}
          isActiveRegion={inputActive}
          onFocusGame={onFocusGame}
          onSelectGame={onGameSelect}
          title=""
        />

        <div className="h-16" />
      </div>

      <div className="absolute bottom-0 left-0 right-0 h-20 flex items-end pb-3 px-[5%] bg-gradient-to-t from-vault-bg via-vault-bg/80 to-transparent pointer-events-none">
        <p className="text-vault-muted text-xs uppercase tracking-wide flex items-center gap-1.5 flex-wrap">
          <Glyph type="cross" /> Select  ·  <Glyph type="circle" /> Back  ·  D-Pad Navigate
        </p>
      </div>
    </div>
  )
}
