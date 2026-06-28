import { useState, useEffect } from 'react'
import type { User } from '@retro-vault/shared'
import { api } from '../api/client'
import { useGamepad } from '../hooks/useGamepad'

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

  useEffect(() => {
    api.users.list().then(u => {
      setUsers(u)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  const items = [...users, { id: -1, username: '+ New Profile', avatar_color: '#444', created_at: '' }]

  useGamepad((action) => {
    if (creating) return

    if (action === 'left') setFocusedIndex(i => Math.max(0, i - 1))
    if (action === 'right') setFocusedIndex(i => Math.min(items.length - 1, i + 1))
    if (action === 'up') setFocusedIndex(i => Math.max(0, i - 4))
    if (action === 'down') setFocusedIndex(i => Math.min(items.length - 1, i + 4))

    if (action === 'confirm') {
      const item = items[focusedIndex]
      if (item?.id === -1) {
        setCreating(true)
      } else if (item) {
        onSelect(item as User)
      }
    }
  })

  const handleCreate = async () => {
    if (!newName.trim()) return
    try {
      const user = await api.users.create(newName.trim(), newColor)
      setUsers(prev => [...prev, user])
      setCreating(false)
      setNewName('')
      onSelect(user)
    } catch {
      // username taken — could show error
    }
  }

  return (
    <div className="fixed inset-0 bg-vault-bg flex flex-col items-center justify-center">
      <div className="mb-12">
        <h1 className="text-white text-4xl font-bold tracking-tight text-center">RetroVault</h1>
        <p className="text-vault-muted text-sm uppercase tracking-widest text-center mt-2">Choose your profile</p>
      </div>

      {loading ? (
        <div className="grid grid-cols-4 gap-8">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="flex flex-col items-center gap-3">
              <div className="w-24 h-24 rounded-full bg-vault-muted animate-pulse" />
              <div className="h-3 w-16 bg-vault-muted animate-pulse rounded" />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-4 gap-8 px-[5%]">
          {items.map((item, i) => {
            const focused = focusedIndex === i
            const isNew = item.id === -1
            return (
              <div
                key={item.id}
                className="flex flex-col items-center gap-3 cursor-pointer"
                onClick={() => {
                  if (isNew) setCreating(true)
                  else onSelect(item as User)
                }}
              >
                <div
                  className={[
                    'w-24 h-24 rounded-full flex items-center justify-center transition-transform duration-150',
                    'motion-reduce:transition-none',
                    focused ? 'ring-4 ring-vault-accent scale-110 motion-reduce:scale-100' : 'ring-0',
                  ].join(' ')}
                  style={{ background: isNew ? '#1e1e2a' : item.avatar_color }}
                >
                  {isNew ? (
                    <span className="text-vault-muted text-3xl font-light">+</span>
                  ) : (
                    <span className="text-white text-3xl font-bold uppercase">
                      {item.username.charAt(0)}
                    </span>
                  )}
                </div>
                <p className={`text-sm font-medium ${focused ? 'text-white' : 'text-vault-muted'} uppercase tracking-wide`}>
                  {item.username}
                </p>
              </div>
            )
          })}
        </div>
      )}

      {creating && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50">
          <div className="bg-vault-card rounded-2xl p-8 w-96 space-y-6">
            <h2 className="text-white text-xl font-bold">New Profile</h2>

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
                className="w-full bg-vault-surface border border-vault-muted rounded-lg px-4 py-3 text-white text-sm focus:outline-none focus:border-vault-accent"
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

            <div className="flex gap-3">
              <button
                onClick={() => void handleCreate()}
                className="flex-1 py-3 bg-vault-accent text-white font-bold rounded-lg uppercase tracking-wide text-sm"
              >
                Create
              </button>
              <button
                onClick={() => setCreating(false)}
                className="flex-1 py-3 bg-vault-surface text-vault-muted font-bold rounded-lg uppercase tracking-wide text-sm border border-vault-muted"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      <p className="absolute bottom-8 text-vault-muted text-xs uppercase tracking-widest">
        ✕ Select  ·  D-Pad Navigate
      </p>
    </div>
  )
}
