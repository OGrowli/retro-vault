import type { Config } from 'tailwindcss'

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        vault: {
          bg: '#0a0a0f',
          card: '#16161e',
          surface: '#1e1e2a',
          accent: '#0070D1',
          'accent-bright': '#0090ff',
          // 10-foot rule: secondary text must survive a TV at couch distance.
          // Was #3a3a4a (~1.9:1 on bg) — unreadable by design.
          muted: '#9aa3b5',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
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
