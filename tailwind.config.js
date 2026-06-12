/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Deep desaturated slate for navigation surfaces — calm, professional.
        nav: {
          DEFAULT: '#1E2433',
          light: '#2A3144',
        },
        // Slightly desaturated action blue for buttons and links.
        primary: {
          DEFAULT: '#3B6FD4',
          light: '#5585DD',
          dark: '#2D5CB8',
          50: '#F0F5FD',
          100: '#DCE7F8',
        },
        accent: {
          DEFAULT: '#D97706',
          light: '#FEF3C7',
        },
        success: {
          DEFAULT: '#16A34A',
          light: '#D1FAE5',
        },
        danger: {
          DEFAULT: '#DC2626',
          light: '#FEE2E2',
        },
        background: '#F8FAFC',
      },
    },
  },
  plugins: [],
}
