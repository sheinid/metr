import { defineConfig, loadEnv } from 'vite';
import { createApiHandler, plannerConfig } from './server/handler';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ mode }) => ({
  base: mode === 'pages' ? '/metr/' : '/',
  plugins: [react(), tailwindcss(), { name: 'metr-planner-api', configureServer(server) { server.middlewares.use(createApiHandler(plannerConfig({ ...loadEnv(mode, process.cwd(), ''), ...process.env }))); } }],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-dom/client'],
          ui: ['@heroui/react', 'react-aria-components'],
        },
      },
    },
  },
}));
