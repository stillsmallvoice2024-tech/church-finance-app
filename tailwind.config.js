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
      },
      colors: {
        // Navigation surface
        nav: {
          DEFAULT: '#1E2433',
          light: '#2A3144',
          dark: '#080809',
        },
        // Primary action blue — light and dark variants
        primary: {
          DEFAULT: '#3B6FD4',
          light: '#5585DD',
          dark: '#2D5CB8',
          dm: '#6B9FE4',   // dark-mode primary
          50: '#F0F5FD',
          100: '#DCE7F8',
        },
        accent: {
          DEFAULT: '#D97706',
          light: '#FEF3C7',
          dm: '#fbbf24',   // dark-mode accent
        },
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
