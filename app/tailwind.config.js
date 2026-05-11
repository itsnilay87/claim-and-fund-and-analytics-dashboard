/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#eff6ff',
          500: '#6366f1',
          600: '#4f46e5',
          700: '#4338ca',
          900: '#312e81',
        },
        accent: {
          500: '#06b6d4',
          600: '#0891b2',
        },
        platform: {
          bg: '#0B0E17',
          card: '#111827',
          'card-border': '#1F2937',
          'card-hover': '#1a2332',
        },
        fund: {
          primary: '#3B82F6',
          secondary: '#8B5CF6',
          accent: '#06B6D4',
          success: '#10B981',
          warning: '#F59E0B',
          danger: '#EF4444',
        },
        chart: {
          cyan: '#06B6D4',
          purple: '#8B5CF6',
          amber: '#F59E0B',
          green: '#10B981',
          red: '#EF4444',
          blue: '#3B82F6',
          pink: '#EC4899',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      animation: {
        'float': 'float 6s ease-in-out infinite',
        'pulse-slow': 'pulse 4s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
      keyframes: {
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-10px)' },
        },
      },
    },
  },
  plugins: [],
};
