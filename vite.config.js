import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    target: 'es2020',
    cssCodeSplit: true,
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (!id.includes('node_modules')) return;
          if (id.includes('recharts') || id.includes('d3-')) return 'charts';
          if (id.includes('@vercel/analytics')) return 'analytics';
          if (id.includes('react-dom') || id.includes('scheduler') || id.includes('react/')) {
            return 'react-vendor';
          }
          return 'vendor';
        },
      },
    },
  },
});
