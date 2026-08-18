import { useEffect, useRef, useMemo } from 'react'
import type { Game } from '@retro-vault/shared'
import { GameCard } from './GameCard'
import { SkeletonCard } from './SkeletonCard'

const COLS = 6
const CARD_HEIGHT = 256
const GAP = 16
const VISIBLE_ROWS = 3
const BUFFER_ROWS = 1

interface Props {
  /** Total number of games in the (filtered) library — may exceed what's loaded. */
  total: number
  /** Resolve a game by absolute index; undefined if its page isn't loaded yet. */
  getGame: (index: number) => Game | undefined
  /** Called with the visible index window so the parent can fetch missing pages. */
  onNeedRange?: (startIndex: number, endIndexExclusive: number) => void
  loading?: boolean
  focusedRow: number
  focusedCol: number
  isActiveRegion: boolean
  onFocusGame?: (game: Game) => void
  onSelectGame?: (game: Game) => void
  /** Section heading; pass "" to render the grid with no heading */
  title?: string
}

export function VirtualGrid({ total, getGame, onNeedRange, loading, focusedRow, focusedCol, isActiveRegion, onFocusGame, onSelectGame, title = 'All Games' }: Props) {
  const totalRows = Math.ceil(total / COLS)
  const windowStartRef = useRef(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const focusedCardRef = useRef<HTMLDivElement>(null)

  const windowStart = useMemo(() => {
    const ws = windowStartRef.current
    if (focusedRow < ws + BUFFER_ROWS) {
      windowStartRef.current = Math.max(0, focusedRow - BUFFER_ROWS)
    } else if (focusedRow >= ws + VISIBLE_ROWS - BUFFER_ROWS) {
      windowStartRef.current = Math.min(
        totalRows - VISIBLE_ROWS,
        focusedRow - VISIBLE_ROWS + BUFFER_ROWS + 1
      )
    }
    return windowStartRef.current
  }, [focusedRow, totalRows])

  const windowEnd = Math.min(totalRows, windowStart + VISIBLE_ROWS + BUFFER_ROWS * 2)

  // Ask the parent to load whatever pages back the visible window.
  useEffect(() => {
    if (total === 0) return
    onNeedRange?.(windowStart * COLS, Math.min(total, windowEnd * COLS))
  }, [windowStart, windowEnd, total, onNeedRange])

  useEffect(() => {
    if (!isActiveRegion || !containerRef.current) return
    const focusedGame = getGame(focusedRow * COLS + focusedCol)
    if (focusedGame) onFocusGame?.(focusedGame)
    focusedCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [focusedRow, focusedCol, isActiveRegion, getGame, onFocusGame])

  const paddingTop = windowStart * (CARD_HEIGHT + GAP)
  const paddingBottom = Math.max(0, (totalRows - windowEnd) * (CARD_HEIGHT + GAP))

  const renderedRows = []
  for (let row = windowStart; row < windowEnd; row++) {
    const rowItems = []
    for (let col = 0; col < COLS; col++) {
      const idx = row * COLS + col
      if (idx >= total) break
      const focused = isActiveRegion && focusedRow === row && focusedCol === col
      const game = getGame(idx)
      rowItems.push(
        <div key={idx} ref={focused ? focusedCardRef : null}>
          {game
            ? <GameCard game={game} focused={focused} onClick={onSelectGame} />
            : <SkeletonCard />}
        </div>
      )
    }
    renderedRows.push(
      <div key={row} className="flex gap-4">
        {rowItems}
      </div>
    )
  }

  return (
    <section className="px-[5%] py-3">
      {title && (
        <h2 className="mb-3 flex items-baseline gap-3">
          <span className="font-display text-3xl tracking-[-0.015em] text-[#eaf0f8]">{title}</span>
          {!loading && (
            <span className="text-vault-muted font-mono text-[0.85rem] uppercase tracking-[0.1em]">{total} titles</span>
          )}
        </h2>
      )}
      <div ref={containerRef}>
        {loading ? (
          <div className="flex gap-4 flex-wrap">
            {Array.from({ length: COLS * 2 }, (_, i) => <SkeletonCard key={i} />)}
          </div>
        ) : total === 0 ? (
          <p className="text-vault-muted text-sm py-8 text-center">
            No games match the current filters.
          </p>
        ) : (
          <div style={{ paddingTop, paddingBottom }}>
            <div className="flex flex-col gap-4">
              {renderedRows}
            </div>
          </div>
        )}
      </div>
    </section>
  )
}

export { COLS as GRID_COLS }
