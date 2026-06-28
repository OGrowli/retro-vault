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
}

export function getSystemConfig(system: string): SystemConfig | undefined {
  return SYSTEMS[system.toLowerCase()]
}
