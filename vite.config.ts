import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'

function versionPlugin() {
  return {
    name: 'version-json',
    buildStart() {
      const out = path.join(process.cwd(), 'public', 'version.json')
      fs.writeFileSync(out, JSON.stringify({ v: new Date().toISOString() }))
    },
  }
}

export default defineConfig({
  plugins: [react(), versionPlugin()],
  build: {
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      output: {
        // Split heavy, independently-loadable libraries into their own chunks
        // so they are fetched only by the routes that use them.
        manualChunks: {
          'vendor-pdf':    ['pdfjs-dist'],
          'vendor-xlsx':   ['xlsx'],
          'vendor-jspdf':  ['jspdf', 'jspdf-autotable'],
          'vendor-charts': ['recharts'],
        },
      },
    },
  },
  test: {
    environment: 'node',
    env: {
      VITE_SUPABASE_URL:      'http://localhost:54321',
      VITE_SUPABASE_ANON_KEY: 'test-anon-key',
    },
  },
})
