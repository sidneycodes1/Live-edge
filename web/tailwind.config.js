export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#0B0B10',
        surface: '#15151C',
        yes: '#3DFFB5',
        no: '#FF5E6C',
        live: '#FFB800',
      },
      fontFamily: {
        heading: ['Space Grotesk', 'system-ui', 'sans-serif'],
        body: ['Inter', 'system-ui', 'sans-serif'],
      },
      borderRadius: { card: '12px' },
    },
  },
  plugins: [],
};
