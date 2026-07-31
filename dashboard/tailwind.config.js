/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        apple: {
          bg: '#F5F5F7',
          card: '#FFFFFF',
          cardHover: '#FAFAFC',
          sidebar: '#F2F2F7',
          border: '#E5E5EA',
          borderLight: '#F0F0F5',
          text: '#1D1D1F',
          muted: '#86868B',
          subtle: '#6E6E73',
          blue: '#0071E3',
          blueHover: '#0077ED',
          blueLight: '#E8F2FF',
          green: '#34C759',
          greenLight: '#EAFCEB',
          red: '#FF3B30',
          redLight: '#FFEBEA',
          orange: '#FF9500',
          orangeLight: '#FFF4E5',
          purple: '#AF52DE',
          purpleLight: '#F8EFFF'
        }
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', '"SF Pro Display"', '"SF Pro Text"', '"Plus Jakarta Sans"', 'Inter', 'sans-serif']
      },
      boxShadow: {
        'apple-sm': '0 2px 8px rgba(0, 0, 0, 0.04)',
        'apple-md': '0 4px 16px rgba(0, 0, 0, 0.06)',
        'apple-lg': '0 12px 32px rgba(0, 0, 0, 0.08)',
        'apple-glow': '0 8px 24px rgba(0, 113, 227, 0.15)'
      }
    },
  },
  plugins: [],
}
