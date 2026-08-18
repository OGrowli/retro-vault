import { useState, useEffect, useRef } from 'react'
import type { User } from '@retro-vault/shared'
import { api } from '../api/client'
import { useGamepad } from '../hooks/useGamepad'
import { Clock } from '../components/Clock'
import { VirtualKeyboard } from '../components/VirtualKeyboard'
import { Breadcrumb, Title, Rule, HintBar, rowClass, Caret } from '../components/ui'

const COLORS = [
  '#0070D1', '#e74c3c', '#2ecc71', '#f39c12',
  '#9b59b6', '#1abc9c', '#e67e22', '#34495e',
  '#e91e63', '#00bcd4',
]

interface Props {
  onSelect: (user: User) => void
}

export function ProfileSelect({ onSelect }: Props) {
  const [users, setUsers] = useState<User[]>([])
  const [focusedIndex, setFocusedIndex] = useState(0)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState(COLORS[0])
  const [colorIdx, setColorIdx] = useState(0)
  const [loading, setLoading] = useState(true)
  const [createError, setCreateError] = useState<string | null>(null)
  const itemRefs = useRef<(HTMLDivElement | null)[]>([])

  useEffect(() => {
    api.users.list().then(u => {
      setUsers(u)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  const items = [...users, { id: -1, username: '+ New Profile', avatar_color: '#444', created_at: '' }]

  // Keep the focused avatar visible when there are enough profiles to scroll.
  useEffect(() => {
    if (!creating) itemRefs.current[focusedIndex]?.scrollIntoView({ block: 'nearest' })
  }, [focusedIndex, creating])

  useGamepad((action) => {
    if (action === 'up') setFocusedIndex(i => Math.max(0, i - 1))
    if (action === 'down') setFocusedIndex(i => Math.min(items.length - 1, i + 1))

    if (action === 'confirm') {
      const item = items[focusedIndex]
      if (item?.id === -1) {
        setCreating(true)
      } else if (item) {
        onSelect(item as User)
      }
    }
  }, !creating)

  const handleCreate = async () => {
    if (!newName.trim()) return
    setCreateError(null)
    try {
      const user = await api.users.create(newName.trim(), newColor)
      setUsers(prev => [...prev, user])
      setCreating(false)
      setNewName('')
      onSelect(user)
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : 'Could not create profile')
    }
  }

  return (
    <div className="fixed inset-0 bg-vault-bg flex flex-col px-[5%] py-[3.5%] font-sans">
      <div className="flex items-center justify-between">
        <Breadcrumb>retrovault / profile</Breadcrumb>
        <Clock />
      </div>

      <Title className="text-7xl mt-6 mb-6">Who's playing?</Title>
      <Rule />

      {loading ? (
        <div className="flex-1 flex flex-col gap-1 mt-2">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="h-16 bg-vault-panel animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto py-2 flex flex-col" style={{ scrollbarWidth: 'none' }}>
          {items.map((item, i) => {
            const focused = focusedIndex === i
            const isNew = item.id === -1
            return (
              <div
                key={item.id}
                ref={el => { itemRefs.current[i] = el }}
                className={rowClass(focused)}
                onMouseEnter={() => setFocusedIndex(i)}
                onClick={() => {
                  if (isNew) setCreating(true)
                  else onSelect(item as User)
                }}
              >
                <Caret selected={focused} />
                {!isNew && (
                  <span
                    className="w-3.5 h-3.5 rounded-full flex-none"
                    style={{ background: item.avatar_color }}
                  />
                )}
                <span className={`text-4xl ${isNew && !focused ? 'text-vault-accent' : ''}`}>
                  {isNew ? 'New Profile' : item.username}
                </span>
                <span className="flex-1" />
                <span className={`font-mono text-[0.95rem] tracking-[0.06em] ${focused ? 'text-vault-ink/70' : 'text-vault-muted'}`}>
                  {isNew ? 'a opens keyboard' : 'select profile'}
                </span>
              </div>
            )
          })}
        </div>
      )}

      <HintBar hints={['d-pad move', 'a select', 'b back to landing']} />

      {creating && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 px-4">
          <div className="bg-vault-panel border border-vault-surface p-6 w-full max-w-[480px] max-h-[90vh] overflow-y-auto space-y-4" style={{ scrollbarWidth: 'none' }}>
            <h2 className="font-display text-4xl">New Profile</h2>

            <div>
              <label className="text-vault-muted text-xs uppercase tracking-wide block mb-2">Username</label>
              <input
                autoFocus
                type="text"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') void handleCreate()
                  if (e.key === 'Escape') setCreating(false)
                }}
                className="w-full bg-vault-surface border border-vault-muted rounded-lg px-4 py-3 text-white text-sm focus:outline-none focus:border-vault-accent font-mono"
                placeholder="Enter username..."
                maxLength={24}
              />
            </div>

            <div>
              <label className="text-vault-muted text-xs uppercase tracking-wide block mb-2">Color</label>
              <div className="flex gap-3 flex-wrap">
                {COLORS.map((color, i) => (
                  <button
                    key={color}
                    onClick={() => { setNewColor(color); setColorIdx(i) }}
                    className={`w-8 h-8 rounded-full transition-transform ${colorIdx === i ? 'scale-125 ring-2 ring-white' : ''}`}
                    style={{ background: color }}
                  />
                ))}
              </div>
            </div>

            {createError && <p className="text-red-400 text-sm">{createError}</p>}

            <VirtualKeyboard
              value={newName}
              onChange={setNewName}
              onDone={() => void handleCreate()}
              onCancel={() => { setCreating(false); setCreateError(null) }}
              enabled={creating}
              maxLength={24}
            />
          </div>
        </div>
      )}
    </div>
  )
}
