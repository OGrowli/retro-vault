import { useEffect, useRef, useCallback } from 'react'

export type GamepadAction =
  | 'up' | 'down' | 'left' | 'right'
  | 'confirm' | 'back' | 'favorite' | 'filter'

const BTN = {
  CROSS: 0,
  CIRCLE: 1,
  SQUARE: 2,
  TRIANGLE: 3,
  L1: 4,
  R1: 5,
  OPTIONS: 9,
  DPAD_UP: 12,
  DPAD_DOWN: 13,
  DPAD_LEFT: 14,
  DPAD_RIGHT: 15,
}

const AXIS_THRESHOLD = 0.5
const INITIAL_DELAY = 400
const REPEAT_RATE = 150

interface PressState {
  pressed: boolean
  firstAt: number
  lastRepeat: number
  fired: boolean
}

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
    const loop = (now: number) => {
      if (!enabledRef.current) {
        rafRef.current = requestAnimationFrame(loop)
        return
      }

      const active = getButtonStates()
      const state = stateRef.current

      for (const action of ['up', 'down', 'left', 'right', 'confirm', 'back', 'favorite', 'filter'] as GamepadAction[]) {
        const isPressed = active.get(action) ?? false
        let s = state.get(action)

        if (isPressed) {
          if (!s || !s.pressed) {
            s = { pressed: true, firstAt: now, lastRepeat: now, fired: false }
            state.set(action, s)
            onActionRef.current(action)
            s.fired = true
          } else {
            const held = now - s.firstAt
            if (held >= INITIAL_DELAY) {
              if (now - s.lastRepeat >= REPEAT_RATE) {
                onActionRef.current(action)
                s.lastRepeat = now
              }
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
    return () => cancelAnimationFrame(rafRef.current)
  }, [getButtonStates])
}
