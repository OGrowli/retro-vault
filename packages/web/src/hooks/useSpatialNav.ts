import { useState, useCallback, useRef, useEffect } from 'react'
import type { GamepadAction } from './useGamepad'

export type Region =
  | 'profile-select'
  | 'recently-played'
  | 'favorites'
  | 'all-games'
  | 'filter-drawer'
  | 'game-detail'
  | 'versions-list'
  | 'settings'

interface RegionState {
  row: number
  col: number
}

interface UseSpatialNavOptions {
  recentCount: number
  favoritesCount: number
  allGamesCount: number
  gridCols: number
  /** Adds one focusable "See More" slot at the end of the row */
  recentSeeMore?: boolean
  favoritesSeeMore?: boolean
  /** Column count per drawer row; row order defined by the drawer layout */
  filterDrawerRowCounts: number[]
  onConfirm?: (region: Region, row: number, col: number) => void
  onBack?: () => void
  filterDrawerOpen: boolean
  onToggleFilter?: () => void
  onFavorite?: (region: Region, row: number, col: number) => void
  onSettings?: () => void
}

const DEFAULT_INDICES: Record<Region, RegionState> = {
  'profile-select':  { row: 0, col: 0 },
  'recently-played': { row: 0, col: 0 },
  'favorites':       { row: 0, col: 0 },
  'all-games':       { row: 0, col: 0 },
  'filter-drawer':   { row: 0, col: 0 },
  'game-detail':     { row: 0, col: 0 },
  'versions-list':   { row: 0, col: 0 },
  'settings':        { row: 0, col: 0 },
}

export function useSpatialNav(opts: UseSpatialNavOptions) {
  const [region, setRegion] = useState<Region>('recently-played')
  const [indices, setIndices] = useState<Record<Region, RegionState>>(DEFAULT_INDICES)

  const optsRef = useRef(opts)
  optsRef.current = opts

  // When filter drawer opens, start focus on the first chip row
  useEffect(() => {
    if (opts.filterDrawerOpen) {
      setIndices(prev => ({ ...prev, 'filter-drawer': { row: 0, col: 0 } }))
    }
  }, [opts.filterDrawerOpen])

  const resetIndex = useCallback((r: Region) => {
    setIndices(prev => ({ ...prev, [r]: { row: 0, col: 0 } }))
  }, [])

  const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v))

  const getIndex = useCallback((r: Region) => indices[r], [indices])

  const updateIndex = useCallback((r: Region, update: Partial<RegionState>) => {
    setIndices(prev => ({ ...prev, [r]: { ...prev[r], ...update } }))
  }, [])

  const handleAction = useCallback((action: GamepadAction) => {
    const o = optsRef.current

    if (action === 'settings') {
      o.onSettings?.()
      return
    }

    if (action === 'filter') {
      o.onToggleFilter?.()
      return
    }

    if (o.filterDrawerOpen) {
      const cur = indices['filter-drawer']
      const counts = o.filterDrawerRowCounts
      const colMax = (r: number) => Math.max(0, (counts[r] ?? 1) - 1)
      if (action === 'up' || action === 'down') {
        const newRow = clamp(cur.row + (action === 'down' ? 1 : -1), 0, counts.length - 1)
        updateIndex('filter-drawer', { row: newRow, col: clamp(cur.col, 0, colMax(newRow)) })
      }
      if (action === 'left') updateIndex('filter-drawer', { col: clamp(cur.col - 1, 0, colMax(cur.row)) })
      if (action === 'right') updateIndex('filter-drawer', { col: clamp(cur.col + 1, 0, colMax(cur.row)) })
      if (action === 'back') o.onToggleFilter?.()
      if (action === 'confirm') o.onConfirm?.('filter-drawer', cur.row, cur.col)
      return
    }

    if (action === 'back') { o.onBack?.(); return }

    if (action === 'favorite') {
      const cur = indices[region]
      o.onFavorite?.(region, cur.row, cur.col)
      return
    }

    if (action === 'confirm') {
      const cur = indices[region]
      o.onConfirm?.(region, cur.row, cur.col)
      return
    }

    if (region === 'recently-played') {
      const cur = indices['recently-played']
      const maxCol = o.recentCount - 1 + (o.recentSeeMore ? 1 : 0)
      if (action === 'left') updateIndex('recently-played', { col: clamp(cur.col - 1, 0, maxCol) })
      if (action === 'right') updateIndex('recently-played', { col: clamp(cur.col + 1, 0, maxCol) })
      if (action === 'down') setRegion(o.favoritesCount > 0 ? 'favorites' : 'all-games')
    }

    if (region === 'favorites') {
      const cur = indices['favorites']
      const maxCol = o.favoritesCount - 1 + (o.favoritesSeeMore ? 1 : 0)
      if (action === 'left') updateIndex('favorites', { col: clamp(cur.col - 1, 0, maxCol) })
      if (action === 'right') updateIndex('favorites', { col: clamp(cur.col + 1, 0, maxCol) })
      if (action === 'up') setRegion('recently-played')
      if (action === 'down') setRegion('all-games')
    }

    if (region === 'all-games') {
      const cur = indices['all-games']
      const totalRows = Math.ceil(o.allGamesCount / o.gridCols)
      if (action === 'left') updateIndex('all-games', { col: clamp(cur.col - 1, 0, o.gridCols - 1) })
      if (action === 'right') updateIndex('all-games', { col: clamp(cur.col + 1, 0, o.gridCols - 1) })
      if (action === 'down') updateIndex('all-games', { row: clamp(cur.row + 1, 0, totalRows - 1) })
      if (action === 'up') {
        if (cur.row === 0) setRegion(o.favoritesCount > 0 ? 'favorites' : 'recently-played')
        else updateIndex('all-games', { row: cur.row - 1 })
      }
    }

    if (region === 'profile-select') {
      const cur = indices['profile-select']
      if (action === 'left') updateIndex('profile-select', { col: clamp(cur.col - 1, 0, 3) })
      if (action === 'right') updateIndex('profile-select', { col: clamp(cur.col + 1, 0, 3) })
      if (action === 'up') updateIndex('profile-select', { row: clamp(cur.row - 1, 0, 4) })
      if (action === 'down') updateIndex('profile-select', { row: clamp(cur.row + 1, 0, 4) })
    }
  }, [region, indices, updateIndex])

  return { region, setRegion, getIndex, handleAction, resetIndex }
}
