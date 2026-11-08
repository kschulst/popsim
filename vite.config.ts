import { defineConfig } from 'vite';

// Relative base so each frozen build works under /vN/ on GitHub Pages.
export default defineConfig({
  base: './',
  test: { environment: 'node' },
});
