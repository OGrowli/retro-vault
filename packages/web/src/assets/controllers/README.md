# Controller diagrams

Hand-drawn SVG diagrams for the controller settings screen, one per system,
named by system key: `<system>.svg`.

Expected files:

```
nes.svg  snes.svg  megadrive.svg  mastersystem.svg  gb.svg  gbc.svg  gba.svg
n64.svg  psx.svg  fds.svg  gamegear.svg  neogeo.svg  ngp.svg  ngpc.svg
pcengine.svg  sg-1000.svg  arcade.svg  atari5200.svg  atari7800.svg
atarilynx.svg  vectrex.svg
```

They are loaded via `import.meta.glob('../assets/controllers/*.svg')` in
`src/data/controllerLayouts.ts` (see `diagramFor`). Missing files are handled
gracefully — the screen shows a placeholder until the SVG is added, so the build
never breaks on an absent diagram.
