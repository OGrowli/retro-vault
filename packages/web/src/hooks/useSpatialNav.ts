import { useState, useCallback, useRef, useEffect } from 'react'
import type { GamepadAction } from './useGamepad'

/** A horizontal rail's focusable region. Rails are identified by a string key
 *  ('recently-played', 'favorites', or `list-<id>`) so custom lists can add rails
 *  dynamically. The grid is 'all-games'; the filter drawer is 'filter-drawer'. */
export type Region = string

interface RegionState {
  row: number
  col: number
}

/** One horizontal rail, in vertical render order. `colCount` is the number of
 *  focusable columns — visible cards plus one for the trailing "Show More" tile. */
export interface RailDef {
  key: string
  colCount: number
}

interface UseSpatialNavOptions {
  /** Rails above the grid, in vertical order (recently, favorites, then lists) */
  rails: RailDef[]
  allGamesCount: number
  gridCols: number
  /** Column count per drawer row; row order defined by the drawer layout */
  filterDrawerRowCounts: number[]
  onConfirm?: (region: Region, row: number, col: number) => void
  onBack?: () => void
  filterDrawerOpen: boolean
  onToggleFilter?: () => void
  onFavorite?: (region: Region, row: number, col: number) => void
  onSettings?: () => void
}

const DEFAULT_STATE: RegionState = { row: 0, col: 0 }

export function useSpatialNav(opts: UseSpatialNavOptions) {
  const [region, setRegion] = useState<Region>('recently-played')
  const [indices, setIndices] = useState<Record<string, RegionState>>({})

  const optsRef = useRef(opts)
  optsRef.current = opts

  const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v))

  // Ordered list of navigable regions (rails with cards, then the grid if it has games).
  const navOrder = (o: UseSpatialNavOptions): string[] => {
    const railKeys = o.rails.filter(r => r.colCount > 0).map(r => r.key)
    return o.allGamesCount > 0 ? [...railKeys, 'all-games'] : railKeys
  }

  // When the focused region empties out (data loads, favorite removed, filter
  // applied), snap focus to the first valid region.
  useEffect(() => {
    if (opts.filterDrawerOpen) return
    const order = navOrder(opts)
    if (order.length && !order.includes(region)) {
      setRegion(order[0])
    }
  }, [opts.rails, opts.allGamesCount, opts.filterDrawerOpen, region])

  // When filter drawer opens, start focus on the first chip row
  useEffect(() => {
    if (opts.filterDrawerOpen) {
      setIndices(prev => ({ ...prev, 'filter-drawer': { row: 0, col: 0 } }))
    }
  }, [opts.filterDrawerOpen])

  const resetIndex = useCallback((r: Region) => {
    setIndices(prev => ({ ...prev, [r]: { row: 0, col: 0 } }))
  }, [])

  const getIndex = useCallback((r: Region) => indices[r] ?? DEFAULT_STATE, [indices])

  const updateIndex = useCallback((r: Region, update: Partial<RegionState>) => {
    setIndices(prev => ({ ...prev, [r]: { ...(prev[r] ?? DEFAULT_STATE), ...update } }))
  }, [])

  const handleAction = useCallback((action: GamepadAction) => {
    const o = optsRef.current

    if (action === 'settings') { o.onSettings?.(); return }
    if (action === 'filter') { o.onToggleFilter?.(); return }

    if (o.filterDrawerOpen) {
      const cur = indices['filter-drawer'] ?? DEFAULT_STATE
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

    const cur = indices[region] ?? DEFAULT_STATE

    if (action === 'favorite') { o.onFavorite?.(region, cur.row, cur.col); return }
    if (action === 'confirm') { o.onConfirm?.(region, cur.row, cur.col); return }

    const order = navOrder(o)
    const pos = order.indexOf(region)

    if (region === 'all-games') {
      const totalRows = Math.ceil(o.allGamesCount / o.gridCols)
      if (action === 'left') updateIndex('all-games', { col: clamp(cur.col - 1, 0, o.gridCols - 1) })
      if (action === 'right') updateIndex('all-games', { col: clamp(cur.col + 1, 0, o.gridCols - 1) })
      if (action === 'down') updateIndex('all-games', { row: clamp(cur.row + 1, 0, totalRows - 1) })
      if (action === 'up') {
        if (cur.row === 0) { if (pos > 0) setRegion(order[pos - 1]) }
        else updateIndex('all-games', { row: cur.row - 1 })
      }
      return
    }

    // Otherwise: a horizontal rail region.
    const rail = o.rails.find(r => r.key === region)
    if (!rail) return
    const maxCol = Math.max(0, rail.colCount - 1)
    if (action === 'left') updateIndex(region, { col: clamp(cur.col - 1, 0, maxCol) })
    if (action === 'right') updateIndex(region, { col: clamp(cur.col + 1, 0, maxCol) })
    if (action === 'down') { if (pos !== -1 && pos < order.length - 1) setRegion(order[pos + 1]) }
    if (action === 'up') { if (pos > 0) setRegion(order[pos - 1]) }
  }, [region, indices, updateIndex])

  return { region, setRegion, getIndex, handleAction, resetIndex }
}
