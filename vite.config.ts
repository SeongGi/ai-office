import { defineConfig } from 'vite';

const floor = `http://127.0.0.1:${process.env.AGENT_FLOOR_PORT || 4317}`;

export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      '/events': floor,
      '/state': floor,
      '/reset': floor,
      '/health': floor,
      '/stream': { target: floor, changeOrigin: true },
    },
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 900,
  },
});
