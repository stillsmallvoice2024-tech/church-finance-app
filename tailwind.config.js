/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Plus Jakarta Sans', 'sans-serif'],
        body: ['Inter', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      colors: {
        // Navigation surface — Deep Navy
        nav: {
          DEFAULT: '#1A2C42',
          light: '#243552',
          dark: '#0F1C2E',
        },
        // Primary — Teal Anchor
        primary: {
          DEFAULT: '#0D7377',
          light: '#14A085',
          dark: '#0A5C60',
          dm: '#14A085',   // dark-mode primary
          50: '#E6F4F1',
          100: '#C2E8E2',
        },
        // Accent — Gold Honour
        accent: {
          DEFAULT: '#C89B3C',
          light: '#FEF3C7',
          dm: '#D4AF37',   // dark-mode accent
        },
        // Brand surface
        tealMist: '#E6F4F1',
        silverCloud: '#F7F9FA',
        slate: '#4A5568',
        deepNavy: '#1A2C42',
        success: {
          DEFAULT: '#16A34A',
          light: '#D1FAE5',
          dm: '#4ade80',   // dark-mode success
        },
        danger: {
          DEFAULT: '#DC2626',
          light: '#FEE2E2',
          dm: '#f87171',   // dark-mode danger
        },
        background: '#F8FAFC',
        // Explicit surface levels for dark mode
        surface: {
          0: '#0c0c0e',   // page background
          1: '#141416',   // cards
          2: '#1c1c1e',   // modals / elevated
          3: '#232325',   // inputs / selects
        },
      },
      boxShadow: {
        card: '0 1px 4px rgba(0,0,0,0.06)',
        'card-md': '0 4px 12px rgba(0,0,0,0.08)',
      },
    },
  },
  plugins: [],
}
