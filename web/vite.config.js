import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // VITE_* vars (e.g. VITE_PRIVY_APP_ID, VITE_API_URL) come from the REPO ROOT .env,
  // not web/ — deterministic for dev + build, main checkout and agent worktrees alike.
  // Only VITE_-prefixed vars are ever exposed to the client; secrets stay out.
  envDir: '..',
  server: { port: 5173, host: true },
});
