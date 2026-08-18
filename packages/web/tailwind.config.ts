import type { Config } from 'tailwindcss'

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Console / RetroVault mode — "terminal-meets-PS5". Flat fills, cyan
        // primary used sparingly, magenta as the selection bar accent.
        vault: {
          bg: '#0b0a12',
          card: '#16142a',
          surface: '#262340',
          panel: '#12101c',
          accent: '#6fd3ff',       // cyan bright — primary accent (text/labels)
          'accent-bright': '#35c6ff', // cyan fill — selected-row background
          'accent-dim': '#2f9dc9',  // cyan hairline/border
          ink: '#0c0a16',           // dark text on cyan fill
          pink: '#ff3d9a',          // selection bar + hack/translation accent
          'pink-soft': '#ff7ab8',
          // 10-foot rule: secondary text must survive a TV at couch distance.
          muted: '#a6afc2',
        },
        // idGames / Doom mode — warm palette, orange primary, gold bar accent.
        idg: {
          bg: '#16100f',
          text: '#f5efe8',
          accent: '#ff8a3d',        // orange bright
          fill: '#ff6b1a',          // orange fill — selected-row background
          dim: '#c8621f',           // orange hairline/border
          gold: '#f5c04a',          // selection bar accent
          ink: '#140c08',           // dark text on orange fill
          muted: '#b7ab9e',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        // Display serif for titles, prose serif for descriptions/reviews,
        // mono for labels/tags/breadcrumbs/hints (uppercase, letterspaced).
        display: ["'Cormorant Garamond'", 'Georgia', 'serif'],
        read: ['Lora', 'Georgia', 'serif'],
        mono: ['ui-monospace', "'SF Mono'", 'Menlo', 'monospace'],
      },
      screens: {
        tv: '1920px',
      },
      keyframes: {
        'fade-in': { '0%': { opacity: '0' }, '100%': { opacity: '1' } },
        'slide-in': { '0%': { transform: 'translateX(-100%)' }, '100%': { transform: 'translateX(0)' } },
        'rise-in': { '0%': { opacity: '0', transform: 'translateY(8px)' }, '100%': { opacity: '1', transform: 'translateY(0)' } },
      },
      animation: {
        'fade-in': 'fade-in 200ms ease-out',
        'slide-in': 'slide-in 250ms cubic-bezier(0.25, 0.46, 0.45, 0.94)',
        'rise-in': 'rise-in 220ms cubic-bezier(0.25, 0.46, 0.45, 0.94)',
      },
    },
  },
  plugins: [],
} satisfies Config
