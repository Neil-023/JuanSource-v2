export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // optional custom colors if you want them
        'bg-dark': '#0b0b0f',
        'panel-dark': '#0f1115',
        'muted-dark': '#9aa0a6',
        // purple accent
        'accent-from': '#6d28d9',
        'accent-to': '#7c3aed',
      }
    }
  },
  plugins: [],
}
