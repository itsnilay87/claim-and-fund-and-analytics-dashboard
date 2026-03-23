import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';

/**
 * Custom plugin: serve /data/ from ../test_outputs/ in dev mode.
 * In production build, copies JSON files into dist/data/.
 */
function serveTestOutputs() {
  const testOutputsDir = path.resolve(__dirname, '../test_outputs');
  const outputsDir = path.resolve(__dirname, '../outputs');

  return {
    name: 'serve-test-outputs',
    configureServer(server) {
      server.middlewares.use('/data', (req, res, next) => {
        // Try test_outputs first, then outputs
        const candidates = [
          path.join(testOutputsDir, req.url),
          path.join(outputsDir, req.url),
        ];

        for (const filePath of candidates) {
          if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
            res.setHeader('Content-Type', 'application/json');
            fs.createReadStream(filePath).pipe(res);
            return;
          }
        }
        next();
      });
    },
    closeBundle() {
      // Copy JSON data files into dist/data/ for production
      const distData = path.resolve(__dirname, 'dist', 'data');
      if (!fs.existsSync(distData)) fs.mkdirSync(distData, { recursive: true });
      const srcDir = fs.existsSync(testOutputsDir) ? testOutputsDir : outputsDir;
      for (const f of ['dashboard_data.json', 'stochastic_pricing.json', 'pricing_surface.json']) {
        const src = path.join(srcDir, f);
        if (fs.existsSync(src)) {
          fs.copyFileSync(src, path.join(distData, f));
        }
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), serveTestOutputs()],
  base: process.env.VITE_BASE_PATH || '/dashboard/',
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
  },
});
