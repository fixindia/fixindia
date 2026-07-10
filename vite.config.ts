import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
// NOTE: test config lives in vitest.config.ts (vitest 3 uses a rollup-based
// vite type set that conflicts with this project's Vite 8 / rolldown types).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // 7.3: code-split heavy vendor libs so the main chunk stays under the
  // 500 kB warning threshold and the map only loads when first shown.
  // (MapEngine itself is React.lazy'd in App.tsx, which already isolates
  // maplibre-gl into a lazy chunk; this further splits shared vendors.)
  build: {
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          if (id.includes('maplibre-gl') || id.includes('mapbox-gl') || id.includes('react-map-gl')) {
            return 'map-vendor';
          }
          if (id.includes('framer-motion')) return 'framer-motion';
          if (id.includes('@clerk')) return 'clerk';
        },
      },
    },
  },
})
