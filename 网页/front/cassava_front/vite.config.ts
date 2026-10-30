import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    __APP_ENV__: JSON.stringify('development')
  },
  optimizeDeps: {
    exclude: ['lucide-react'],
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true
      },
      '/media': {
        target: 'http://localhost:8000',
        changeOrigin: true
      }
    }
  },
  build: {
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return;

          if (id.includes('react-dom') || id.includes('react-router-dom') || /node_modules[\\/](react|scheduler|use-sync-external-store)[\\/]/.test(id)) {
            return 'react-core';
          }

          if (id.includes('antd') || id.includes('@ant-design') || id.includes('rc-')) {
            return 'ui-kit';
          }

          if (id.includes('lucide-react')) {
            return 'icons';
          }

          if (id.includes('axios')) {
            return 'network';
          }

          if (id.includes('qrcode.react')) {
            return 'qrcode';
          }

          if (id.includes('@babel/runtime')) {
            return 'runtime';
          }
        }
      }
    }
  }
});
