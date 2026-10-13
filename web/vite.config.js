import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '..', 'VITE_');
  // Shell/host environment overrides an accidental local value in root .env.
  const api = String(process.env.VITE_API_URL || env.VITE_API_URL || '').trim();
  if (mode === 'production' && (!api || /^https?:\/\/(localhost|127\.0\.0\.1)(?::\d+)?\/?$/i.test(api))) {
    throw new Error('Production build requires VITE_API_URL to be a non-localhost deployed API URL.');
  }
  return {
  plugins: [react()],
  // VITE_* vars (e.g. VITE_PRIVY_APP_ID, VITE_API_URL) come from the REPO ROOT .env,
  // not web/ — deterministic for dev + build, main checkout and agent worktrees alike.
  // Only VITE_-prefixed vars are ever exposed to the client; secrets stay out.
  envDir: '..',
  server: { port: 5173, host: true },
  };
});
