# Web App Deployment Instructions

## Netlify

1. **Connect Repository**
   - Go to Netlify dashboard
   - Add new site → Import from Git
   - Select your repository

2. **Build Settings**
   - Build command: `cd web && npm run build`
   - Publish directory: `web/dist`
   - Node version: 20

3. **Environment Variables**
   - `VITE_API_URL`: Your backend URL (e.g., `https://liveedge-api.onrender.com`)

4. **SPA Fallback**
   - Go to Site Settings → Build & deploy → Redirects
   - Add redirect rule:
     ```
     /* /index.html 200
     ```

## Vercel

1. **Install Vercel CLI**
   ```bash
   npm i -g vercel
   ```

2. **Deploy**
   ```bash
   cd web
   vercel
   ```

3. **Configure Project**
   - Framework preset: Vite
   - Build command: `npm run build`
   - Output directory: `dist`
   - Install command: `npm install`

4. **Environment Variables**
   - `VITE_API_URL`: Your backend URL

5. **SPA Rewrites**
   - Create `vercel.json` in `web/`:
     ```json
     {
       "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
     }
     ```

## Static Build (Manual)

```bash
cd web
npm run build
# Upload contents of web/dist to any static hosting service
```

## Notes

- The web app is a SPA (Single Page Application) and requires client-side routing
- All API calls go to the backend via `VITE_API_URL` environment variable
- Default `VITE_API_URL` is `http://localhost:4000` for development
- No server-side rendering is used
