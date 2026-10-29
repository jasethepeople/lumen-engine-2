/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          950: '#0a0a0d',
          900: '#101014',
          850: '#15151b',
          800: '#1b1b22',
          700: '#26262f',
          600: '#3a3a46',
          400: '#8a8a96',
          300: '#b4b4be',
          200: '#d6d6dd',
          100: '#ececf0',
        },
        accent: '#8ab4ff',
      },
      fontFamily: {
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
};
