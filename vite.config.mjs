import { defineConfig } from 'vite';
export default defineConfig({ base: './', worker: { format: 'es' }, server: { host: '127.0.0.1', port: 5173, strictPort: true }, build: { outDir: 'dist' } });
