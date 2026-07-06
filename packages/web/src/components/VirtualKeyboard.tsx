import { useState } from 'react'
import { useGamepad } from '../hooks/useGamepad'

const ROWS: string[][] = [
  ['1','2','3','4','5','6','7','8','9','0'],
  ['q','w','e','r','t','y','u','i','o','p'],
  ['a','s','d','f','g','h','j','k','l','⌫'],
  ['z','x','c','v','b','n','m'],
  ['SPACE','✓'],
]

interface Props {
  value: string
  onChange: (v: string) => void
  onDone: () => void
  onCancel: () => void
  enabled: boolean
  maxLength?: number
  masked?: boolean
}

export function VirtualKeyboard({ value, onChange, onDone, onCancel, enabled, maxLength, masked }: Props) {
  const [row, setRow] = useState(1)
  const [col, setCol] = useState(0)

  const pressKey = (key: string) => {
    if (key === '⌫') { onChange(value.slice(0, -1)); return }
    if (key === '✓') { onDone(); return }
    const ch = key === 'SPACE' ? ' ' : key
    if (!maxLength || value.length < maxLength) onChange(value + ch)
  }

  const moveTo = (fromRow: number, fromCol: number, toRow: number) => {
    const fromLen = ROWS[fromRow]?.length ?? 1
    const toLen = ROWS[toRow]?.length ?? 1
    const ratio = fromLen > 1 ? fromCol / (fromLen - 1) : 0
    setRow(toRow)
    setCol(Math.round(ratio * (toLen - 1)))
  }

  useGamepad((action) => {
    if (action === 'back') { onCancel(); return }
    if (action === 'up') moveTo(row, col, Math.max(0, row - 1))
    if (action === 'down') moveTo(row, col, Math.min(ROWS.length - 1, row + 1))
    if (action === 'left') setCol(c => Math.max(0, c - 1))
    if (action === 'right') setCol(c => Math.min((ROWS[row]?.length ?? 1) - 1, c + 1))
    if (action === 'confirm') {
      const key = ROWS[row]?.[col]
      if (key) pressKey(key)
    }
  }, enabled)

  const display = masked ? '•'.repeat(value.length) : value

  return (
    <div className="select-none">
      <div className="mb-3 bg-vault-surface border border-vault-muted rounded-lg px-4 py-2.5 min-h-[42px] flex items-center gap-1.5">
        <span className="text-white text-sm font-mono flex-1 min-w-0 truncate">
          {display || <span className="text-vault-muted not-italic">—</span>}
        </span>
        <span className="w-px h-4 bg-vault-accent inline-block animate-pulse flex-shrink-0" />
      </div>

      <div className="space-y-1.5">
        {ROWS.map((keys, ri) => (
          <div
            key={ri}
            className={ri === ROWS.length - 1 ? 'flex gap-2 justify-center' : 'flex gap-1 justify-center'}
          >
            {keys.map((key, ci) => {
              const isFocused = enabled && row === ri && col === ci
              const base = 'flex items-center justify-center font-bold uppercase tracking-wide transition-all duration-75 border rounded-lg'
              const focusCls = isFocused ? 'ring-2 ring-vault-accent border-vault-accent text-white scale-110' : ''

              if (key === 'SPACE') {
                return (
                  <button key={key}
                    onPointerDown={e => { e.preventDefault(); pressKey(key) }}
                    className={`${base} h-10 flex-1 max-w-[200px] text-xs text-vault-muted bg-vault-surface ${focusCls || 'border-vault-muted'}`}
                  >
                    SPACE
                  </button>
                )
              }
              if (key === '✓') {
                return (
                  <button key={key}
                    onPointerDown={e => { e.preventDefault(); pressKey(key) }}
                    className={`${base} h-10 min-w-[90px] text-sm text-white bg-vault-accent ${isFocused ? 'ring-2 ring-white scale-110 border-vault-accent' : 'border-vault-accent'}`}
                  >
                    Done ✓
                  </button>
                )
              }
              return (
                <button key={`${key}-${ci}`}
                  onPointerDown={e => { e.preventDefault(); pressKey(key) }}
                  className={`${base} w-9 h-9 text-sm text-white ${key === '⌫' ? 'bg-vault-surface text-vault-muted' : 'bg-vault-card'} ${focusCls || 'border-vault-muted'}`}
                >
                  {key}
                </button>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}
