import path from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  // `vite preview` serves the built bundle, and the UI-05 performance cases
  // measure against it rather than against the dev server: a dev server ships
  // hundreds of unbundled ES modules, so an LCP measured there is a number
  // about Vite, not about the app anyone will load. preview needs its own
  // proxy block — it does not inherit `server.proxy`.
  preview: {
    port: 4173,
    host: true,
    proxy: {
      '/v1': {
        target: process.env.BACKEND_URL || 'http://127.0.0.1:5000',
        changeOrigin: true,
        secure: false,
      },
      '/uploads': {
        target: process.env.BACKEND_URL || 'http://127.0.0.1:5000',
        changeOrigin: true,
        secure: false,
      },
    },
  },
  server: {
    port: 3000,
    host: true,
    allowedHosts: 'all',
    proxy: {
      '/v1': {
        target: process.env.BACKEND_URL || 'http://127.0.0.1:5000',
        changeOrigin: true,
        secure: false,
      },
      // Uploaded files are stored as "/uploads/<name>" and rendered straight
      // into <img src>. Without this the dev server answers with its SPA
      // fallback (index.html) instead of the file, so every uploaded photo
      // silently renders as the default avatar even though the upload worked.
      '/uploads': {
        target: process.env.BACKEND_URL || 'http://127.0.0.1:5000',
        changeOrigin: true,
        secure: false,
      },
    },
  },
})
