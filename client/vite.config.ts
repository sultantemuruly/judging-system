import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  server: {
    host: true, // Listen on all local IPs
    port: 5173,
    // The admin login is plain HTTP; the WebSocket goes straight to :8080.
    proxy: { '/api': 'http://localhost:8080' },
  }
})
