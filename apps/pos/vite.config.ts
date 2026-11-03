import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'node:path';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.png'],
      manifest: {
        name: '#turisteando · PoS',
        short_name: '#turisteando',
        description: 'Punto de venta',
        theme_color: '#E93BA1',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/favicon.png', sizes: '400x400', type: 'image/png' },
          { src: '/favicon.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/favicon.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      workbox: {
        // OJO: sacamos 'html' del precache y usamos NetworkFirst para
        // navegaciones. Motivo — bug del cliente 2026-07-14 (Agus, B12):
        // al reabrir el PoS después de un deploy quedaba pantalla en
        // blanco y solo Ctrl+F5 lo arreglaba. Con el HTML precacheado,
        // el SW servía el index.html VIEJO que apuntaba a chunks JS
        // con hash viejo (ej. index-abc123.js) que Vercel ya había
        // borrado en el deploy nuevo — pantalla blanca hasta refresh
        // manual.
        //
        // Ahora: los chunks/assets siguen precacheados (offline first),
        // pero el HTML pasa por NetworkFirst con timeout 3s → siempre
        // trae el index.html nuevo con los hashes de chunks nuevos, y
        // si no hay red usa el cache como fallback.
        globPatterns: ['**/*.{js,css,png,woff2}'],
        cleanupOutdatedCaches: true,
        skipWaiting: true,
        clientsClaim: true,
        runtimeCaching: [
          {
            urlPattern: ({ request }) => request.mode === 'navigate',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'html-cache',
              networkTimeoutSeconds: 3,
              expiration: { maxEntries: 4 },
            },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: { port: 3100 },
});
