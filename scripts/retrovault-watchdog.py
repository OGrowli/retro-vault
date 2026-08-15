#!/usr/bin/env python3
"""RetroVault controller recovery watchdog.

Reads the gamepad straight from the kernel (/dev/input/js0), so it keeps working
even when the Chromium kiosk is frozen — the in-app Gamepad API path is dead in
that state. Holding the recovery chord (PS + Options) for a few seconds tears the
kiosk down and draws a D-pad-navigable recovery menu on tty1.

The teardown mirrors scripts/launch-game.sh: stop getty@tty1, free the VT, then a
menu choice restarts the frontend (autologin + .bash_profile relaunch the kiosk),
optionally bounces the API, or reboots.

Run standalone for testing:
    sudo python3 scripts/retrovault-watchdog.py --dry-run
"""

import os
import select
import struct
import subprocess
import sys
import time

# ---------------------------------------------------------------------------
# Config — button numbers are the /dev/input/js0 indices, which differ from the
# browser mapping in packages/web/src/hooks/useGamepad.ts. Confirm them on the
# real controller with:  jstest --normal /dev/input/js0
# ---------------------------------------------------------------------------
BTN_PS = 10           # PS / Guide button (BTN_MODE) — verify with jstest
BTN_OPTIONS = 9       # Options / Start button (BTN_START) — verify with jstest
CHORD = frozenset({BTN_PS, BTN_OPTIONS})
HOLD_SECONDS = 3.0

BTN_CONFIRM = 0       # Cross — selects the highlighted menu row
DPAD_UP = None        # set to a js button number if your D-pad reports as buttons
DPAD_DOWN = None
AXIS_VERTICAL = 1     # left-stick Y — navigates the menu (fallback for D-pad hats)
AXIS_THRESHOLD = 0.5

JS_DEVICE = "/dev/input/js0"
TTY = "/dev/tty1"

# Linux joystick event: struct js_event { __u32 time; __s16 value; __u8 type; __u8 number; }
JS_EVENT = struct.Struct("IhBB")
JS_EVENT_BUTTON = 0x01
JS_EVENT_AXIS = 0x02
JS_EVENT_INIT = 0x80

DRY_RUN = "--dry-run" in sys.argv


def log(msg):
    print(f"[watchdog] {msg}", flush=True)


def run(cmd):
    """Run a recovery command (skipped, only logged, under --dry-run)."""
    log(("DRY-RUN " if DRY_RUN else "") + "exec: " + " ".join(cmd))
    if DRY_RUN:
        return
    subprocess.run(cmd, check=False)


class Joystick:
    """Non-blocking reader for /dev/input/js0 that reopens on hotplug."""

    def __init__(self, path):
        self.path = path
        self.fd = None
        self.buf = b""
        self.buttons = set()          # currently-held button numbers
        self.axes = {}                # axis number -> float [-1, 1]

    def _open(self):
        while self.fd is None:
            try:
                self.fd = os.open(self.path, os.O_RDONLY | os.O_NONBLOCK)
                self.buf = b""
                log(f"opened {self.path}")
            except OSError:
                time.sleep(1.0)

    def _close(self):
        if self.fd is not None:
            try:
                os.close(self.fd)
            except OSError:
                pass
        self.fd = None

    def pump(self, timeout):
        """Block up to `timeout`s for events, applying them to button/axis state.

        Returns a list of (kind, number) edges for navigation:
        ('button', n) on press, ('up', None)/('down', None) on axis edge.
        """
        self._open()
        edges = []
        r, _, _ = select.select([self.fd], [], [], timeout)
        if not r:
            return edges
        try:
            data = os.read(self.fd, 64)
        except OSError:
            self._close()
            return edges
        if not data:
            self._close()
            return edges
        self.buf += data
        while len(self.buf) >= JS_EVENT.size:
            chunk, self.buf = self.buf[:JS_EVENT.size], self.buf[JS_EVENT.size:]
            _, value, etype, number = JS_EVENT.unpack(chunk)
            etype &= ~JS_EVENT_INIT
            if etype == JS_EVENT_BUTTON:
                if value:
                    if number not in self.buttons:
                        edges.append(("button", number))
                    self.buttons.add(number)
                else:
                    self.buttons.discard(number)
            elif etype == JS_EVENT_AXIS:
                prev = self.axes.get(number, 0.0)
                cur = value / 32767.0
                self.axes[number] = cur
                if number == AXIS_VERTICAL:
                    if prev > -AXIS_THRESHOLD and cur <= -AXIS_THRESHOLD:
                        edges.append(("up", None))
                    elif prev < AXIS_THRESHOLD and cur >= AXIS_THRESHOLD:
                        edges.append(("down", None))
        return edges

    def chord_held(self):
        return CHORD.issubset(self.buttons)


# ---------------------------------------------------------------------------
# Recovery menu
# ---------------------------------------------------------------------------
MENU = [
    ("Restart frontend", lambda: run(["systemctl", "start", "getty@tty1"])),
    ("Restart frontend + API", lambda: (
        run(["systemctl", "restart", "retrovault-api"]),
        run(["systemctl", "start", "getty@tty1"]),
    )),
    ("Reboot", lambda: run(["systemctl", "reboot"])),
    ("Shutdown", lambda: run(["systemctl", "poweroff"])),
    ("Cancel (relaunch frontend)", lambda: run(["systemctl", "start", "getty@tty1"])),
]


def free_vt():
    """Kill the kiosk session and free tty1 (mirrors launch-game.sh)."""
    run(["systemctl", "stop", "getty@tty1"])
    run(["pkill", "-TERM", "-t", "tty1"])
    if not DRY_RUN:
        for _ in range(20):
            out = subprocess.run(["ps", "-t", "tty1", "-o", "pid="],
                                 capture_output=True, text=True).stdout.strip()
            if not out:
                break
            time.sleep(0.5)
    run(["pkill", "-KILL", "-t", "tty1"])
    run(["chvt", "1"])


def draw_menu(tty, selected):
    lines = ["", "  RetroVault — Recovery", "  ─────────────────────", ""]
    for i, (label, _) in enumerate(MENU):
        marker = ">" if i == selected else " "
        lines.append(f"  {marker} {label}")
    lines += ["", "  D-pad: move   Cross: select", ""]
    body = "\x1b[2J\x1b[H\x1b[?25l" + "\r\n".join(lines)
    if tty is not None:
        try:
            tty.write(body.encode())
            tty.flush()
            return
        except OSError:
            pass
    # Dry-run / no tty: fall back to stdout so the menu is still visible.
    log("menu:\n" + "\r\n".join(lines))


def show_menu(js):
    """Draw the menu and let the user pick with the D-pad + Cross. Returns action."""
    tty = None
    if not DRY_RUN:
        try:
            tty = open(TTY, "wb", buffering=0)
        except OSError:
            tty = None
    selected = 0
    draw_menu(tty, selected)
    # Let the chord release before accepting input, so the hold doesn't fall
    # through into the menu.
    while js.chord_held():
        js.pump(0.05)
    try:
        while True:
            for kind, number in js.pump(0.1):
                if kind == "up" or (kind == "button" and number == DPAD_UP):
                    selected = (selected - 1) % len(MENU)
                    draw_menu(tty, selected)
                elif kind == "down" or (kind == "button" and number == DPAD_DOWN):
                    selected = (selected + 1) % len(MENU)
                    draw_menu(tty, selected)
                elif kind == "button" and number == BTN_CONFIRM:
                    return MENU[selected]
            if DRY_RUN:
                # No interactive TTY under dry-run; auto-pick Cancel and bail.
                log("dry-run: auto-selecting 'Cancel'")
                return MENU[-1]
    finally:
        if tty is not None:
            try:
                tty.write(b"\x1b[2J\x1b[H\x1b[?25h")
                tty.flush()
                tty.close()
            except OSError:
                pass


def kiosk_mode():
    """True when the kiosk (not a game) owns the display — getty@tty1 active."""
    if DRY_RUN:
        return True
    return subprocess.run(["systemctl", "is-active", "--quiet", "getty@tty1"]).returncode == 0


def recover(js):
    if not kiosk_mode():
        log("chord ignored — a game is running (getty@tty1 inactive)")
        return
    log("chord fired — entering recovery")
    free_vt()
    _, action = show_menu(js)
    action()


def main():
    log("starting" + (" (dry-run)" if DRY_RUN else ""))
    js = Joystick(JS_DEVICE)
    chord_start = None
    while True:
        js.pump(0.1)
        if js.chord_held():
            if chord_start is None:
                chord_start = time.monotonic()
            elif time.monotonic() - chord_start >= HOLD_SECONDS:
                chord_start = None
                recover(js)
        else:
            chord_start = None


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        pass
