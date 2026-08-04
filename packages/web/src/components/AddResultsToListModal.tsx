import { useState, useEffect, useCallback, useRef } from 'react'
import type { Game, GameList, User } from '@retro-vault/shared'
import { api } from '../api/client'
import { useGamepad } from '../hooks/useGamepad'
import { Glyph } from './Glyph'
import { VirtualKeyboard } from './VirtualKeyboard'
import { loadHomePrefs, listOrderOf } from '../prefs'

interface Props {
  /** The current search/filter results to add. */
  games: Game[]
  user: User
  onClose: () => void
  /** Fires with the new list's id after creation, so the home layout can default it hidden. */
  onListCreated?: (listId: number) => void
  /** Fires after any list is changed, so the caller can refresh its rails. */
  onChanged?: () => void
}

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v))

const titles = (n: number) => `${n} title${n === 1 ? '' : 's'}`

// Bulk sibling of AddToListModal: instead of toggling a single game, it adds the
// whole result set to an existing list or a brand-new one.
export function AddResultsToListModal({ games, user, onClose, onListCreated, onChanged }: Props) {
  const [step, setStep] = useState<'browse' | 'create'>('browse')
  const [lists, setLists] = useState<GameList[]>([])
  const [loading, setLoading] = useState(true)
  const [focusIdx, setFocusIdx] = useState(0) // 0..lists.length; last index = "New List"
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  // rowRefs[0..lists.length] — last entry is the "New List" row.
  const rowRefs = useRef<(HTMLDivElement | null)[]>([])

  const gameIds = games.map(g => g.id)

  useEffect(() => {
    api.lists.forUser(user.id, undefined, listOrderOf(loadHomePrefs(user.id)))
      .then(ls => { setLists(ls); setLoading(false) })
      .catch(() => setLoading(false))
  }, [user.id])

  const showToast = useCallback((msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(t => (t === msg ? null : t)), 1800)
  }, [])

  const addToList = useCallback(async (list: GameList) => {
    if (busy || gameIds.length === 0) return
    setBusy(true)
    try {
      const { added } = await api.lists.addGames(list.id, gameIds)
      setLists(prev => prev.map(l =>
        l.id === list.id ? { ...l, game_count: l.game_count + added } : l
      ))
      onChanged?.()
      showToast(added > 0 ? `Added ${titles(added)} to "${list.name}"` : `Already in "${list.name}"`)
    } catch {
      showToast('Could not add to list')
    } finally {
      setBusy(false)
    }
  }, [busy, gameIds, showToast, onChanged])

  const createList = useCallback(async (rawName: string) => {
    const name = rawName.trim()
    if (!name || busy) return
    setBusy(true)
    try {
      const created = await api.lists.create(user.id, name)
      const { added } = await api.lists.addGames(created.id, gameIds)
      onListCreated?.(created.id)
      onChanged?.()
      setLists(prev => [{ ...created, game_count: added }, ...prev])
      setFocusIdx(0)
      setStep('browse')
      setNewName('')
      showToast(`Created "${name}" with ${titles(added)}`)
    } catch {
      showToast('Could not create list')
    } finally {
      setBusy(false)
    }
  }, [user.id, gameIds, busy, showToast, onListCreated, onChanged])

  const rowCount = lists.length + 1 // + "New List" row

  // Keep the gamepad-focused row visible as it moves past the scroll bounds.
  useEffect(() => {
    if (step !== 'browse') return
    rowRefs.current[focusIdx]?.scrollIntoView({ block: 'nearest' })
  }, [focusIdx, step])

  useGamepad((action) => {
    if (busy) return
    if (action === 'back') { onClose(); return }
    if (action === 'up') setFocusIdx(i => clamp(i - 1, 0, rowCount - 1))
    if (action === 'down') setFocusIdx(i => clamp(i + 1, 0, rowCount - 1))
    if (action === 'confirm') {
      if (focusIdx === lists.length) { setStep('create'); return }
      const list = lists[focusIdx]
      if (list) void addToList(list)
    }
  }, step === 'browse')

  return (
    <>
      <div className="fixed inset-0 bg-black/80 z-40" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
        <div
          className="bg-vault-card rounded-2xl p-6 w-full max-w-[460px] max-h-[85vh] flex flex-col gap-4 animate-rise-in motion-reduce:animate-none"
          style={{ boxShadow: '0 24px 64px rgba(0,0,0,0.6)' }}
        >
          {step === 'browse' ? (
            <>
              <div>
                <h2 className="text-white text-xl font-extrabold">Add Results to List</h2>
                <p className="text-vault-accent-bright text-xs font-semibold uppercase tracking-wide mt-0.5">
                  {titles(games.length)} from your search
                </p>
              </div>

              <div className="flex flex-col gap-1.5 overflow-y-auto max-h-[260px] pr-0.5" style={{ scrollbarWidth: 'none' }}>
                {loading ? (
                  <p className="text-vault-muted text-sm text-center py-4">Loading lists…</p>
                ) : (
                  <>
                    {lists.length === 0 && (
                      <p className="text-vault-muted text-sm text-center py-4">No lists yet — create your first one below.</p>
                    )}
                    {lists.map((list, i) => {
                      const focused = focusIdx === i
                      return (
                        <div
                          key={list.id}
                          ref={el => { rowRefs.current[i] = el }}
                          onMouseEnter={() => setFocusIdx(i)}
                          onClick={() => void addToList(list)}
                          className={[
                            'flex items-center gap-3.5 px-3.5 py-3 rounded-2xl bg-vault-surface cursor-pointer',
                            'border transition-[box-shadow,transform,border-color] duration-150 motion-reduce:transition-none',
                            focused ? 'border-transparent ring-2 ring-vault-accent scale-[1.015]' : 'border-transparent',
                          ].join(' ')}
                        >
                          <span className="w-[22px] h-[22px] rounded-full flex-shrink-0 flex items-center justify-center border border-vault-muted">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-vault-muted">
                              <line x1="12" y1="5" x2="12" y2="19" />
                              <line x1="5" y1="12" x2="19" y2="12" />
                            </svg>
                          </span>
                          <span className="flex-1 min-w-0 text-[0.92rem] font-semibold text-[#eaeaf2] truncate">{list.name}</span>
                          <span className="flex-shrink-0 text-xs text-vault-muted uppercase tracking-wide">
                            {titles(list.game_count)}
                          </span>
                        </div>
                      )
                    })}

                    <div
                      ref={el => { rowRefs.current[lists.length] = el }}
                      onMouseEnter={() => setFocusIdx(lists.length)}
                      onClick={() => setStep('create')}
                      className={[
                        'flex items-center gap-3.5 px-3.5 py-3 rounded-2xl cursor-pointer',
                        'border border-dashed transition-colors duration-150 motion-reduce:transition-none',
                        focusIdx === lists.length ? 'border-vault-accent' : 'border-vault-muted',
                      ].join(' ')}
                    >
                      <span className="w-[22px] h-[22px] rounded-full flex-shrink-0 flex items-center justify-center border border-dashed border-vault-muted">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-vault-muted">
                          <line x1="12" y1="5" x2="12" y2="19" />
                          <line x1="5" y1="12" x2="19" y2="12" />
                        </svg>
                      </span>
                      <span className="flex-1 text-[0.92rem] font-semibold text-vault-muted">New List from Results</span>
                    </div>
                  </>
                )}
              </div>

              <p className="text-vault-muted text-xs uppercase tracking-wide flex items-center justify-center gap-1.5 flex-wrap">
                <Glyph type="cross" /> Add  ·  <Glyph type="circle" /> Close  ·  ↑↓ Navigate
              </p>
            </>
          ) : (
            <>
              <div>
                <h2 className="text-white text-xl font-extrabold">New List</h2>
                <p className="text-vault-accent-bright text-xs font-semibold uppercase tracking-wide mt-0.5">
                  {titles(games.length)} will be added automatically
                </p>
              </div>

              <div>
                <label className="text-vault-muted text-xs uppercase tracking-wide block mb-2">List Name</label>
                <input
                  autoFocus
                  type="text"
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && newName.trim()) void createList(newName)
                    if (e.key === 'Escape') setStep('browse')
                  }}
                  maxLength={40}
                  placeholder="e.g. SNES RPGs"
                  className="w-full bg-vault-surface border border-vault-accent rounded-xl px-3.5 py-3 text-white text-[0.95rem] focus:outline-none"
                />
              </div>

              <VirtualKeyboard
                value={newName}
                onChange={setNewName}
                onDone={() => void createList(newName)}
                onCancel={() => setStep('browse')}
                enabled={step === 'create'}
                maxLength={40}
              />
            </>
          )}
        </div>
      </div>

      {toast && (
        <div className="fixed left-1/2 -translate-x-1/2 bottom-10 z-[60] bg-vault-accent text-white text-sm font-bold px-4 py-2.5 rounded-full shadow-lg animate-fade-in">
          {toast}
        </div>
      )}
    </>
  )
}
