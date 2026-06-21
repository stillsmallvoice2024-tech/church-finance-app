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
  },
  test: {
    environment: 'node',
    env: {
      VITE_SUPABASE_URL:      'http://localhost:54321',
      VITE_SUPABASE_ANON_KEY: 'test-anon-key',
    },
  },
})
