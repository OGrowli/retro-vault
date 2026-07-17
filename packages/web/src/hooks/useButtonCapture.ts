import { useEffect, useRef } from 'react'

// Captures the raw joypad button index of the next button the user presses,
// via the same Gamepad API polling useGamepad uses. Button indices vary by
// controller/driver and can't be assumed, so bindings must be recorded live.
//
// Buttons already held when capture starts (e.g. the Cross press that opened
// the binder) are swallowed until released, so they can't self-bind. A digit
// key 0–9 also binds that index, for dev machines without a gamepad.
export function useButtonCapture(active: boolean, onCapture: (buttonIndex: number) => void) {
  const onCaptureRef = useRef(onCapture)
  onCaptureRef.current = onCapture

  useEffect(() => {
    if (!active) return

    let raf = 0
    let done = false
    const held = new Set<number>()
    let initialized = false

    const finish = (index: number) => {
      if (done) return
      done = true
      onCaptureRef.current(index)
    }

    const loop = () => {
      if (done) return
      let pressedNew = -1
      for (const pad of navigator.getGamepads()) {
        if (!pad) continue
        for (let i = 0; i < pad.buttons.length; i++) {
          if (pad.buttons[i]?.pressed) {
            if (!initialized) held.add(i)
            else if (!held.has(i) && pressedNew === -1) pressedNew = i
          } else {
            held.delete(i)
          }
        }
      }
      initialized = true
      if (pressedNew !== -1) { finish(pressedNew); return }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)

    const onKey = (e: KeyboardEvent) => {
      if (e.key >= '0' && e.key <= '9') {
        e.preventDefault()
        finish(Number(e.key))
      }
    }
    window.addEventListener('keydown', onKey)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('keydown', onKey)
    }
  }, [active])
}
