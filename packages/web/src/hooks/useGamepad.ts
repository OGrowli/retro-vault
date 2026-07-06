import { useEffect, useRef, useCallback } from 'react'

export type GamepadAction =
  | 'up' | 'down' | 'left' | 'right'
  | 'confirm' | 'back' | 'favorite' | 'filter' | 'settings'

const BTN = {
  CROSS: 0,
  CIRCLE: 1,
  SQUARE: 2,
  TRIANGLE: 3,
  L1: 4,
  R1: 5,
  SHARE: 8,    // → settings
  OPTIONS: 9,  // → filter
  DPAD_UP: 12,
  DPAD_DOWN: 13,
  DPAD_LEFT: 14,
  DPAD_RIGHT: 15,
}

const AXIS_THRESHOLD = 0.5
const INITIAL_DELAY = 400
const REPEAT_RATE = 150

const KEY_MAP: Record<string, GamepadAction> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  Enter: 'confirm',
  Escape: 'back',
  Backspace: 'back',
  f: 'favorite',
  Tab: 'filter',
  s: 'settings',
}

interface PressState {
  pressed: boolean
  firstAt: number
  lastRepeat: number
  fired: boolean
  /** Held since before this hook was enabled — never fire until released */
  swallowed?: boolean
}

const ALL_ACTIONS: GamepadAction[] = ['up', 'down', 'left', 'right', 'confirm', 'back', 'favorite', 'filter', 'settings']

export function useGamepad(
  onAction: (action: GamepadAction) => void,
  enabled = true
) {
  const onActionRef = useRef(onAction)
  onActionRef.current = onAction

  const stateRef = useRef<Map<string, PressState>>(new Map())
  const rafRef = useRef<number>(0)
  const enabledRef = useRef(enabled)
  enabledRef.current = enabled
  // True on mount and whenever the hook is disabled: buttons still held when we
  // (re-)enable belong to the previous screen/modal and must not fire here.
  const needsSwallowRef = useRef(true)

  const getButtonStates = useCallback((): Map<string, boolean> => {
    const active = new Map<string, boolean>()
    const pads = navigator.getGamepads()
    for (const pad of pads) {
      if (!pad) continue

      if (pad.buttons[BTN.DPAD_UP]?.pressed) active.set('up', true)
      if (pad.buttons[BTN.DPAD_DOWN]?.pressed) active.set('down', true)
      if (pad.buttons[BTN.DPAD_LEFT]?.pressed) active.set('left', true)
      if (pad.buttons[BTN.DPAD_RIGHT]?.pressed) active.set('right', true)
      if (pad.buttons[BTN.CROSS]?.pressed) active.set('confirm', true)
      if (pad.buttons[BTN.CIRCLE]?.pressed) active.set('back', true)
      if (pad.buttons[BTN.SQUARE]?.pressed) active.set('favorite', true)
      if (pad.buttons[BTN.SHARE]?.pressed) active.set('settings', true)
      if (pad.buttons[BTN.OPTIONS]?.pressed) active.set('filter', true)

      const ax = pad.axes[0] ?? 0
      const ay = pad.axes[1] ?? 0
      if (ax < -AXIS_THRESHOLD) active.set('left', true)
      if (ax > AXIS_THRESHOLD) active.set('right', true)
      if (ay < -AXIS_THRESHOLD) active.set('up', true)
      if (ay > AXIS_THRESHOLD) active.set('down', true)
    }
    return active
  }, [])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!enabledRef.current || e.repeat) return
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return
      const action = KEY_MAP[e.key]
      if (!action) return
      e.preventDefault()
      onActionRef.current(action)
    }
    window.addEventListener('keydown', onKeyDown)

    const loop = (now: number) => {
      if (!enabledRef.current) {
        needsSwallowRef.current = true
        rafRef.current = requestAnimationFrame(loop)
        return
      }

      const active = getButtonStates()
      const state = stateRef.current

      if (needsSwallowRef.current) {
        needsSwallowRef.current = false
        state.clear()
        for (const action of ALL_ACTIONS) {
          if (active.get(action)) {
            state.set(action, { pressed: true, firstAt: now, lastRepeat: now, fired: true, swallowed: true })
          }
        }
        rafRef.current = requestAnimationFrame(loop)
        return
      }

      for (const action of ALL_ACTIONS) {
        const isPressed = active.get(action) ?? false
        let s = state.get(action)

        if (isPressed) {
          if (!s || !s.pressed) {
            s = { pressed: true, firstAt: now, lastRepeat: now, fired: false }
            state.set(action, s)
            onActionRef.current(action)
            s.fired = true
          } else if (!s.swallowed) {
            const held = now - s.firstAt
            if (held >= INITIAL_DELAY && now - s.lastRepeat >= REPEAT_RATE) {
              onActionRef.current(action)
              s.lastRepeat = now
            }
          }
        } else {
          if (s?.pressed) {
            state.set(action, { pressed: false, firstAt: 0, lastRepeat: 0, fired: false })
          }
        }
      }

      rafRef.current = requestAnimationFrame(loop)
    }

    rafRef.current = requestAnimationFrame(loop)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      cancelAnimationFrame(rafRef.current)
    }
  }, [getButtonStates])
}
