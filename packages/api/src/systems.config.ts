const CORES_ROOT = '/opt/retropie/libretrocores'

export interface SystemConfig {
  displayName: string
  corePath: string
  extensions: string[]
}

export const SYSTEMS: Record<string, SystemConfig> = {
  nes: {
    displayName: 'NES',
    corePath: `${CORES_ROOT}/lr-fceumm/fceumm_libretro.so`,
    extensions: ['.nes', '.zip'],
  },
  snes: {
    displayName: 'SNES',
    corePath: `${CORES_ROOT}/lr-snes9x/snes9x_libretro.so`,
    extensions: ['.smc', '.sfc', '.zip'],
  },
  satellaview: {
    displayName: 'Satellaview',
    corePath: `${CORES_ROOT}/lr-snes9x/snes9x_libretro.so`,
    extensions: ['.bs', '.sfc', '.smc', '.zip'],
  },
  n64: {
    displayName: 'Nintendo 64',
    corePath: `${CORES_ROOT}/lr-mupen64plus-next/mupen64plus_next_libretro.so`,
    extensions: ['.z64', '.n64', '.v64', '.zip'],
  },
  psx: {
    displayName: 'PlayStation',
    corePath: `${CORES_ROOT}/lr-pcsx-rearmed/pcsx_rearmed_libretro.so`,
    extensions: ['.bin', '.cue', '.img', '.pbp', '.chd'],
  },
  gb: {
    displayName: 'Game Boy',
    corePath: `${CORES_ROOT}/lr-gambatte/gambatte_libretro.so`,
    extensions: ['.gb', '.zip'],
  },
  gbc: {
    displayName: 'Game Boy Color',
    corePath: `${CORES_ROOT}/lr-gambatte/gambatte_libretro.so`,
    extensions: ['.gbc', '.zip'],
  },
  gba: {
    displayName: 'Game Boy Advance',
    corePath: `${CORES_ROOT}/lr-mgba/mgba_libretro.so`,
    extensions: ['.gba', '.zip'],
  },
  megadrive: {
    displayName: 'Mega Drive',
    corePath: `${CORES_ROOT}/lr-genesis-plus-gx/genesis_plus_gx_libretro.so`,
    extensions: ['.md', '.bin', '.smd', '.gen', '.zip'],
  },
  genesis: {
    displayName: 'Genesis',
    corePath: `${CORES_ROOT}/lr-genesis-plus-gx/genesis_plus_gx_libretro.so`,
    extensions: ['.md', '.bin', '.smd', '.gen', '.zip'],
  },
  mastersystem: {
    displayName: 'Master System',
    corePath: `${CORES_ROOT}/lr-genesis-plus-gx/genesis_plus_gx_libretro.so`,
    extensions: ['.sms', '.zip'],
  },
  'mame-libretro': {
    displayName: 'Arcade (MAME)',
    corePath: `${CORES_ROOT}/lr-mame2003-plus/mame2003_plus_libretro.so`,
    extensions: ['.zip'],
  },
  arcade: {
    displayName: 'Arcade',
    corePath: `${CORES_ROOT}/lr-mame2003-plus/mame2003_plus_libretro.so`,
    extensions: ['.zip'],
  },
  fba: {
    displayName: 'Arcade (FBA)',
    corePath: `${CORES_ROOT}/lr-fbneo/fbneo_libretro.so`,
    extensions: ['.zip'],
  },
  fbneo: {
    displayName: 'Arcade (FBNeo)',
    corePath: `${CORES_ROOT}/lr-fbneo/fbneo_libretro.so`,
    extensions: ['.zip'],
  },

  // --- Curator collection systems (folder keys match the staging script) ----
  neogeo: {
    displayName: 'Neo Geo',
    corePath: `${CORES_ROOT}/lr-fbneo/fbneo_libretro.so`,
    extensions: ['.zip', '.neo'],
  },
  atari2600: {
    displayName: 'Atari 2600',
    corePath: `${CORES_ROOT}/lr-stella/stella_libretro.so`,
    extensions: ['.a26', '.bin', '.zip'],
  },
  atari5200: {
    displayName: 'Atari 5200',
    corePath: `${CORES_ROOT}/lr-atari800/atari800_libretro.so`,
    extensions: ['.a52', '.bin', '.zip'],
  },
  atari7800: {
    displayName: 'Atari 7800',
    corePath: `${CORES_ROOT}/lr-prosystem/prosystem_libretro.so`,
    extensions: ['.a78', '.bin', '.zip'],
  },
  atarijaguar: {
    displayName: 'Atari Jaguar',
    corePath: `${CORES_ROOT}/lr-virtualjaguar/virtualjaguar_libretro.so`,
    extensions: ['.j64', '.jag', '.rom', '.zip'],
  },
  atarilynx: {
    displayName: 'Atari Lynx',
    corePath: `${CORES_ROOT}/lr-handy/handy_libretro.so`,
    extensions: ['.lnx', '.zip'],
  },
  amstradcpc: {
    displayName: 'Amstrad CPC / GX4000',
    corePath: `${CORES_ROOT}/lr-caprice32/cap32_libretro.so`,
    extensions: ['.dsk', '.sna', '.cpr', '.zip'],
  },
  coleco: {
    displayName: 'ColecoVision',
    corePath: `${CORES_ROOT}/lr-gearcoleco/gearcoleco_libretro.so`,
    extensions: ['.col', '.cv', '.bin', '.rom', '.zip'],
  },
  channelf: {
    displayName: 'Fairchild Channel F',
    corePath: `${CORES_ROOT}/lr-freechaf/freechaf_libretro.so`,
    extensions: ['.bin', '.chf', '.rom', '.zip'],
  },
  intellivision: {
    displayName: 'Intellivision',
    corePath: `${CORES_ROOT}/lr-freeintv/freeintv_libretro.so`,
    extensions: ['.int', '.bin', '.rom', '.zip'],
  },
  msx: {
    displayName: 'MSX',
    corePath: `${CORES_ROOT}/lr-bluemsx/bluemsx_libretro.so`,
    extensions: ['.rom', '.mx1', '.mx2', '.dsk', '.cas', '.zip'],
  },
  msx2: {
    displayName: 'MSX2',
    corePath: `${CORES_ROOT}/lr-bluemsx/bluemsx_libretro.so`,
    extensions: ['.rom', '.mx1', '.mx2', '.dsk', '.cas', '.zip'],
  },
  odyssey2: {
    displayName: 'Magnavox Odyssey2',
    corePath: `${CORES_ROOT}/lr-o2em/o2em_libretro.so`,
    extensions: ['.bin', '.zip'],
  },
  fds: {
    displayName: 'Famicom Disk System',
    corePath: `${CORES_ROOT}/lr-fceumm/fceumm_libretro.so`,
    extensions: ['.fds', '.zip'],
  },
  virtualboy: {
    displayName: 'Virtual Boy',
    corePath: `${CORES_ROOT}/lr-beetle-vb/mednafen_vb_libretro.so`,
    extensions: ['.vb', '.vboy', '.bin', '.zip'],
  },
  pokemini: {
    displayName: 'Pokémon Mini',
    corePath: `${CORES_ROOT}/lr-pokemini/pokemini_libretro.so`,
    extensions: ['.min', '.zip'],
  },
  supergrafx: {
    displayName: 'PC Engine SuperGrafx',
    corePath: `${CORES_ROOT}/lr-beetle-supergrafx/mednafen_supergrafx_libretro.so`,
    extensions: ['.pce', '.sgx', '.zip'],
  },
  pcengine: {
    displayName: 'TurboGrafx-16',
    corePath: `${CORES_ROOT}/lr-beetle-pce-fast/mednafen_pce_fast_libretro.so`,
    extensions: ['.pce', '.zip'],
  },
  sega32x: {
    displayName: 'Sega 32X',
    corePath: `${CORES_ROOT}/lr-picodrive/picodrive_libretro.so`,
    extensions: ['.32x', '.bin', '.smd', '.zip'],
  },
  pico: {
    displayName: 'Sega Pico',
    corePath: `${CORES_ROOT}/lr-picodrive/picodrive_libretro.so`,
    extensions: ['.md', '.bin', '.zip'],
  },
  gamegear: {
    displayName: 'Game Gear',
    corePath: `${CORES_ROOT}/lr-genesis-plus-gx/genesis_plus_gx_libretro.so`,
    extensions: ['.gg', '.zip'],
  },
  'sg-1000': {
    displayName: 'SG-1000',
    corePath: `${CORES_ROOT}/lr-genesis-plus-gx/genesis_plus_gx_libretro.so`,
    extensions: ['.sg', '.bin', '.zip'],
  },
  supervision: {
    displayName: 'Watara Supervision',
    corePath: `${CORES_ROOT}/lr-potator/potator_libretro.so`,
    extensions: ['.sv', '.bin', '.zip'],
  },
  megaduck: {
    displayName: 'Mega Duck',
    corePath: `${CORES_ROOT}/lr-sameduck/sameduck_libretro.so`,
    extensions: ['.bin', '.zip'],
  },
  wonderswan: {
    displayName: 'WonderSwan',
    corePath: `${CORES_ROOT}/lr-beetle-cygne/mednafen_wswan_libretro.so`,
    extensions: ['.ws', '.zip'],
  },
  wonderswancolor: {
    displayName: 'WonderSwan Color',
    corePath: `${CORES_ROOT}/lr-beetle-cygne/mednafen_wswan_libretro.so`,
    extensions: ['.wsc', '.ws', '.zip'],
  },
  sufami: {
    displayName: 'SuFami Turbo',
    corePath: `${CORES_ROOT}/lr-snes9x/snes9x_libretro.so`,
    extensions: ['.st', '.zip'],
  },
}

export function getSystemConfig(system: string): SystemConfig | undefined {
  return SYSTEMS[system.toLowerCase()]
}
