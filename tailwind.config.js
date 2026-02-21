module.exports = {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{vue,js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        primary: '#FF0000',
        dark: { bg: '#0f0f0f', surface: '#1a1a1a', card: '#222222' }
      }
    }
  },
  plugins: []
}
