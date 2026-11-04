import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const base = env.VITE_BASE_PATH || '/';
  return {
    base,
    plugins: [react(), tailwindcss(), VitePWA({
      registerType: 'prompt',
      includeAssets: ['icon.svg', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png', '.nojekyll'],
      manifestFilename: 'manifest.json',
      manifest: {
        id: base, name: 'CloudHouse · Nuestro hogar', short_name: 'CloudHouse',
        description: 'La despensa, la compra, el menú y las tareas. Un hogar, en equipo.',
        lang: 'es', start_url: base, scope: base, display: 'standalone',
        background_color: '#f7f8f4', theme_color: '#32634c',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      workbox: { globPatterns: ['**/*.{js,css,html,png,svg,woff2}'], navigateFallback: 'index.html', cleanupOutdatedCaches: true },
    })],
  };
});
