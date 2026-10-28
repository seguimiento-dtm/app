/** Paleta: azul oscuro (estructura y títulos), verde (acción principal y estados correctos), blanco y gris. */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        navy: { 950: '#081322', 900: '#0C1D33', 800: '#132B4A', 700: '#1B3A63', 600: '#25507F', 100: '#E6EDF6', 50: '#F2F6FB' },
        brand: { 700: '#12663A', 600: '#15803D', 500: '#1E9A4C', 100: '#DCF3E4', 50: '#EFFAF3' },
      },
      fontFamily: {
        display: ['Archivo', 'Arial Narrow', 'Arial', 'sans-serif'],
        sans: ['"IBM Plex Sans"', '"Segoe UI"', 'Roboto', 'Arial', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'Consolas', 'monospace'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(12,29,51,.05), 0 1px 1px rgba(12,29,51,.03)',
        lift: '0 1px 2px rgba(12,29,51,.04), 0 8px 24px -8px rgba(12,29,51,.14)',
      },
    },
  },
  plugins: [],
};
