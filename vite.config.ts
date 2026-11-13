import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: { port: 5173, open: true },
  build: { target: 'es2022', sourcemap: true },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
