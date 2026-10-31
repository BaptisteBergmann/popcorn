import { defineConfig } from 'tsup';

// Bundles the server so the @server/ and @shared/ aliases resolve at runtime.
// Dependencies stay external and are installed from node_modules in the image.
export default defineConfig({
  entry: ['src/server/index.ts'],
  outDir: 'dist/server',
  format: 'esm',
  platform: 'node',
  target: 'node22',
  clean: true,
  sourcemap: false,
  tsconfig: 'tsconfig.server.json',
});
