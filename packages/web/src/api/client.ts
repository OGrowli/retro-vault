import type { Game, GameFilter, User, PlaySession } from '@retro-vault/shared'

function filterToParams(filter: GameFilter, userId?: number): string {
  const p = new URLSearchParams()
  if (userId !== undefined) p.set('userId', String(userId))
  if (filter.systems?.length) p.set('systems', filter.systems.join(','))
  if (filter.genres?.length) p.set('genres', filter.genres.join(','))
  if (filter.players !== undefined) p.set('players', String(filter.players))
  if (filter.yearRange) p.set('yearRange', filter.yearRange.join(','))
  if (filter.favoritesOnly) p.set('favoritesOnly', 'true')
  if (filter.neverPlayed) p.set('neverPlayed', 'true')
  if (filter.query) p.set('query', filter.query)
  return p.toString()
}

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json() as Promise<T>
}

async function post<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json() as Promise<T>
}

async function del<T>(url: string): Promise<T> {
  const res = await fetch(url, { method: 'DELETE' })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json() as Promise<T>
}

export const api = {
  games: {
    list: (filter: GameFilter = {}, userId?: number) =>
      get<Game[]>(`/games?${filterToParams(filter, userId)}`),
    random: (filter: GameFilter = {}, userId?: number) =>
      get<Game>(`/games/random?${filterToParams(filter, userId)}`),
    get: (id: number) => get<Game>(`/games/${id}`),
    launch: (id: number) => post<{ launched: boolean; pid?: number }>(`/games/${id}/launch`),
    logSession: (id: number, userId: number, durationSeconds: number, startedAt: string) =>
      post<{ id: number }>(`/games/${id}/session`, { user_id: userId, duration_seconds: durationSeconds, started_at: startedAt }),
  },

  users: {
    list: () => get<User[]>('/users'),
    create: (username: string, avatar_color: string) =>
      post<User>('/users', { username, avatar_color }),
    favorites: (userId: number) => get<Game[]>(`/users/${userId}/favorites`),
    addFavorite: (userId: number, gameId: number) =>
      post<{ favorited: boolean }>(`/users/${userId}/favorites/${gameId}`),
    removeFavorite: (userId: number, gameId: number) =>
      del<{ favorited: boolean }>(`/users/${userId}/favorites/${gameId}`),
    history: (userId: number) =>
      get<(Game & { session_id: number; started_at: string; duration_seconds: number })[]>(
        `/users/${userId}/history`
      ),
  },

  meta: {
    systems: () => get<string[]>('/meta/systems'),
    genres: () => get<string[]>('/meta/genres'),
  },

  import: {
    run: () => post<{ imported: number; errors: string[] }>('/import'),
  },
}

export type { Game, User, PlaySession, GameFilter }
