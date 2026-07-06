import type {
  Game, GameFilter, GameWithRoms, Rom, User,
  HistoryEntry, SessionWithRom,
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
  return p.toString()
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

export const api = {
  games: {
    list: (filter: GameFilter = {}, userId?: number) =>
      get<Game[]>(`/games?${filterToParams(filter, userId)}`),
    random: (filter: GameFilter = {}, userId?: number) =>
      get<Game>(`/games/random?${filterToParams(filter, userId)}`),
    get: (id: number) => get<GameWithRoms>(`/games/${id}`),
    favorite: (id: number, userId: number) =>
      post<{ favorited: boolean }>(`/games/${id}/favorite`, { userId }),
    sessions: (id: number) => get<SessionWithRom[]>(`/games/${id}/sessions`),
    scrape: (id: number, username: string, password: string) =>
      post<Game>(`/games/${id}/scrape`, { username, password }),
  },

  roms: {
    get: (id: number) => get<Rom>(`/roms/${id}`),
    launch: (id: number) => post<{ launched: boolean; pid?: number }>(`/roms/${id}/launch`),
    logSession: (id: number, userId: number, durationSeconds: number, startedAt: string) =>
      post<{ id: number }>(`/roms/${id}/session`, {
        user_id: userId,
        duration_seconds: durationSeconds,
        started_at: startedAt,
      }),
  },

  users: {
    list: () => get<User[]>('/users'),
    create: (username: string, avatar_color: string) =>
      post<User>('/users', { username, avatar_color }),
    favorites: (userId: number) => get<Game[]>(`/users/${userId}/favorites`),
    history: (userId: number) => get<HistoryEntry[]>(`/users/${userId}/history`),
  },

  meta: {
    systems: () => get<string[]>('/meta/systems'),
    genres: () => get<string[]>('/meta/genres'),
  },

  import: {
    run: () => post<ImportResult>('/import'),
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

export type { Game, GameWithRoms, Rom, User, GameFilter, HistoryEntry, SessionWithRom }
export { del }
