import type {
  Game, GameFilter, GameWithRoms, Rom, User,
  HistoryEntry, SessionWithRom, GameList, ListOrder, GameSort,
  ControllerConfig, HotkeyConfig, AudioConfig,
  WifiNetwork, WifiStatus,
  AuditStatus, AuditSystemSummary, AuditSystemReport,
} from '@retro-vault/shared'

function filterToParams(filter: GameFilter, userId?: number): string {
  const p = new URLSearchParams()
  if (userId !== undefined) p.set('userId', String(userId))
  if (filter.systems?.length) p.set('systems', filter.systems.join(','))
  if (filter.genres?.length) p.set('genres', filter.genres.join(','))
  if (filter.players !== undefined) p.set('players', String(filter.players))
  if (filter.yearRange) p.set('yearRange', filter.yearRange.join(','))
  if (filter.favoritesOnly) p.set('favoritesOnly', 'true')
  if (filter.neverPlayed) p.set('neverPlayed', 'true')
  if (filter.noMetadata) p.set('noMetadata', 'true')
  if (filter.query) p.set('query', filter.query)
  if (filter.listId !== undefined) p.set('listId', String(filter.listId))
  return p.toString()
}

// Tiny pre-blurred background variant emitted at scrape time (and lazily by
// the API). Stretched fullscreen, the upscale IS the blur — no CSS filter.
export function bgVariant(boxArtPath: string): string {
  return boxArtPath.replace(/\.jpg$/, '-bg.jpg')
}

async function extractError(res: Response): Promise<string> {
  try {
    const data = await res.clone().json() as Record<string, unknown>
    if (typeof data.error === 'string') return data.error
  } catch { /* fall through */ }
  return `${res.status} ${res.statusText}`
}

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) })
  if (!res.ok) throw new Error(await extractError(res))
  return res.json() as Promise<T>
}

async function post<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  })
  if (!res.ok) throw new Error(await extractError(res))
  return res.json() as Promise<T>
}

async function put<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'PUT',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new Error(await extractError(res))
  return res.json() as Promise<T>
}

async function del<T>(url: string): Promise<T> {
  const res = await fetch(url, { method: 'DELETE', signal: AbortSignal.timeout(10_000) })
  if (!res.ok) throw new Error(await extractError(res))
  return res.json() as Promise<T>
}

export interface ImportResult {
  games_created: number
  games_updated: number
  roms_created: number
  roms_skipped: number
}

export interface ScrapeProgress {
  total: number
  done: number
  failed: number
  current: string | null
  complete: boolean
}

// Cache for the paginated home grid. Keyed by filter+window; cleared whenever a
// write could change library membership (import / favorite / scrape). Keeps
// returning to Home and re-scrolling instant instead of re-fetching pages.
export interface GamePage { total: number; items: Game[] }
const gamesPageCache = new Map<string, GamePage>()
export function invalidateGamesCache(): void { gamesPageCache.clear() }

export const api = {
  games: {
    list: (filter: GameFilter = {}, userId?: number) =>
      get<Game[]>(`/games?${filterToParams(filter, userId)}`),
    // Windowed fetch for the grid. Cached per filter+offset+limit.
    page: async (filter: GameFilter = {}, userId: number | undefined, opts: { limit: number; offset: number }): Promise<GamePage> => {
      const p = filterToParams(filter, userId)
      const key = `${p}|${opts.offset}|${opts.limit}`
      const cached = gamesPageCache.get(key)
      if (cached) return cached
      const sep = p ? '&' : ''
      const res = await get<GamePage>(`/games?${p}${sep}limit=${opts.limit}&offset=${opts.offset}`)
      gamesPageCache.set(key, res)
      return res
    },
    // All matching ids (for bulk "add results to list").
    ids: (filter: GameFilter = {}, userId?: number) =>
      get<number[]>(`/games/ids?${filterToParams(filter, userId)}`),
    random: (filter: GameFilter = {}, userId?: number) =>
      get<Game>(`/games/random?${filterToParams(filter, userId)}`),
    get: (id: number) => get<GameWithRoms>(`/games/${id}`),
    favorite: async (id: number, userId: number) => {
      const res = await post<{ favorited: boolean }>(`/games/${id}/favorite`, { userId })
      invalidateGamesCache() // favoritesOnly filter membership may change
      return res
    },
    sessions: (id: number) => get<SessionWithRom[]>(`/games/${id}/sessions`),
    // Credentials come from saved settings on the server
    scrape: async (id: number) => {
      const res = await post<Game>(`/games/${id}/scrape`)
      invalidateGamesCache() // noMetadata filter + box art change
      return res
    },
  },

  roms: {
    get: (id: number) => get<Rom>(`/roms/${id}`),
    saveState: (id: number) => get<{ exists: boolean; found: string[] }>(`/roms/${id}/savestate`),
    // user_id lets the server log the play session — the kiosk browser is
    // torn down during launch, so the frontend can't log it afterwards
    launch: (id: number, userId: number, fresh = false) =>
      post<{ launched: boolean; pid?: number }>(`/roms/${id}/launch`, { user_id: userId, fresh: fresh || undefined }),
    // One-shot: who was playing what, if a game just ended
    resume: () => get<{ resume: { user_id: number; game_id: number } | null }>('/roms/resume'),
  },

  users: {
    list: () => get<User[]>('/users'),
    create: (username: string, avatar_color: string) =>
      post<User>('/users', { username, avatar_color }),
    favorites: (userId: number, sort?: GameSort) =>
      get<Game[]>(`/users/${userId}/favorites${sort ? `?sort=${sort}` : ''}`),
    history: (userId: number) => get<HistoryEntry[]>(`/users/${userId}/history`),
  },

  lists: {
    forUser: (userId: number, gameId?: number, sort?: ListOrder) => {
      const p = new URLSearchParams()
      if (gameId !== undefined) p.set('gameId', String(gameId))
      if (sort) p.set('sort', sort)
      const qs = p.toString()
      return get<GameList[]>(`/users/${userId}/lists${qs ? `?${qs}` : ''}`)
    },
    create: (userId: number, name: string) =>
      post<GameList>(`/users/${userId}/lists`, { name }),
    games: (listId: number, opts?: { userId?: number; sort?: GameSort }) => {
      const p = new URLSearchParams()
      if (opts?.userId !== undefined) p.set('userId', String(opts.userId))
      if (opts?.sort) p.set('sort', opts.sort)
      const qs = p.toString()
      return get<Game[]>(`/lists/${listId}/games${qs ? `?${qs}` : ''}`)
    },
    toggle: (listId: number, gameId: number) =>
      post<{ included: boolean }>(`/lists/${listId}/games/${gameId}/toggle`),
    addGames: (listId: number, gameIds: number[]) =>
      post<{ added: number }>(`/lists/${listId}/games`, { gameIds }),
    view: (listId: number) => post<{ ok: boolean }>(`/lists/${listId}/view`),
    remove: (listId: number) => del<{ deleted: boolean }>(`/lists/${listId}`),
  },

  meta: {
    systems: () => get<string[]>('/meta/systems'),
    genres: () => get<string[]>('/meta/genres'),
  },

  settings: {
    get: () => get<Record<string, string>>('/settings'),
    save: (s: Record<string, string>) => post<{ saved: boolean }>('/settings', s),
  },

  controllerSettings: {
    get: (system: string) => get<ControllerConfig>(`/controller-settings/${system}`),
    save: (system: string, config: ControllerConfig) =>
      put<{ saved: boolean; config: ControllerConfig }>(`/controller-settings/${system}`, config),
  },

  hotkeySettings: {
    get: () => get<HotkeyConfig>('/hotkey-settings'),
    save: (config: HotkeyConfig) =>
      put<{ saved: boolean; config: HotkeyConfig }>('/hotkey-settings', config),
  },

  audioSettings: {
    get: () => get<AudioConfig>('/audio-settings'),
    save: (config: AudioConfig) =>
      put<{ saved: boolean; config: AudioConfig }>('/audio-settings', config),
  },

  import: {
    run: async () => {
      const res = await post<ImportResult>('/import')
      invalidateGamesCache() // library membership changed
      return res
    },
  },

  wifi: {
    status: () => get<WifiStatus>('/wifi/status'),
    scan: () => get<WifiNetwork[]>('/wifi/scan'),
    connect: (ssid: string, password?: string) =>
      post<{ connected: boolean; error?: string }>('/wifi/connect', { ssid, password }),
    disconnect: () => post<{ ok: boolean; error?: string }>('/wifi/disconnect'),
  },

  system: {
    update: () => post<{ started: boolean; offset: number }>('/system/update'),
    updateLog: (offset: number) =>
      get<{ content: string; offset: number; size: number }>(`/system/update/log?offset=${offset}`),
  },

  audit: {
    run: (systems?: string[]) => post<{ started: boolean; running?: boolean }>('/audit/run', systems ? { systems } : {}),
    status: () => get<AuditStatus>('/audit/status'),
    report: () => get<AuditSystemSummary[]>('/audit/report'),
    system: (system: string) => get<AuditSystemReport>(`/audit/report/${system}`),
  },

  scrape: {
    all: (username: string, password: string, signal?: AbortSignal) =>
      fetch('/scrape/all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
        signal,
      }),
    system: (system: string, username: string, password: string, signal?: AbortSignal) =>
      fetch(`/scrape/system/${system}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
        signal,
      }),
  },
}

export type { Game, GameWithRoms, Rom, User, GameFilter, HistoryEntry, SessionWithRom, GameList, ControllerConfig, HotkeyConfig, AudioConfig, WifiNetwork, WifiStatus }
export { del }
