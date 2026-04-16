/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#1E3A8A',
          light: '#2547A4',
          dark: '#162D6E',
          50: '#EFF6FF',
          100: '#DBEAFE',
        },
        accent: {
          DEFAULT: '#D97706',
          light: '#FEF3C7',
        },
        success: {
          DEFAULT: '#065F46',
          light: '#D1FAE5',
        },
        danger: {
          DEFAULT: '#991B1B',
          light: '#FEE2E2',
        },
        background: '#F8FAFC',
      },
    },
  },
  plugins: [],
}
