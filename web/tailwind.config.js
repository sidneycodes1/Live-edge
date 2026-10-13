export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        canvas: 'rgb(var(--c-canvas) / <alpha-value>)', surface: 'rgb(var(--c-surface) / <alpha-value>)', 'surface-soft': 'rgb(var(--c-surface-soft) / <alpha-value>)',
        ink: 'rgb(var(--c-ink) / <alpha-value>)', 'ink-muted': 'rgb(var(--c-ink-muted) / <alpha-value>)', 'ink-subtle': 'rgb(var(--c-ink-subtle) / <alpha-value>)',
        border: 'rgb(var(--c-border) / <alpha-value>)', 'border-strong': 'rgb(var(--c-border-strong) / <alpha-value>)',
        brand: 'rgb(var(--c-brand) / <alpha-value>)', 'brand-ink': 'rgb(var(--c-brand-ink) / <alpha-value>)', 'brand-deep': 'rgb(var(--c-brand-deep) / <alpha-value>)', 'brand-soft': 'rgb(var(--c-brand-soft) / <alpha-value>)',
        yes: 'rgb(var(--c-yes) / <alpha-value>)', 'on-yes': 'rgb(var(--c-on-yes) / <alpha-value>)', no: 'rgb(var(--c-no) / <alpha-value>)', 'on-no': 'rgb(var(--c-on-no) / <alpha-value>)',
        warn: 'rgb(var(--c-warn) / <alpha-value>)', 'on-warn': 'rgb(var(--c-on-warn) / <alpha-value>)', focus: 'rgb(var(--c-focus) / <alpha-value>)',
        bg: 'rgb(var(--c-canvas) / <alpha-value>)', live: 'rgb(var(--c-warn) / <alpha-value>)',
      },
      fontFamily: {
        display: ['Fredoka', 'ui-rounded', 'system-ui', 'sans-serif'],
        heading: ['Fredoka', 'ui-rounded', 'system-ui', 'sans-serif'],
        body: ['Nunito', 'system-ui', 'sans-serif'],
      },
      borderRadius: { sm: '8px', card: '20px', sheet: '28px' },
      boxShadow: { card: '0 8px 24px rgb(var(--c-shadow) / 0.08)', press: '0 3px 0 rgb(var(--c-brand-deep) / 1)' },
    },
  },
  plugins: [],
};
