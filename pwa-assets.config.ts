import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config';

// One-off: `pnpm exec pwa-assets-generator` regenerates the committed icons from icon.svg.
const background = '#130e0a'; // = --background; keep in sync with vite.config.ts and index.html

export default defineConfig({
  headLinkOptions: { preset: '2023' },
  preset: {
    ...minimal2023Preset,
    maskable: { ...minimal2023Preset.maskable, resizeOptions: { background } },
    apple: { ...minimal2023Preset.apple, resizeOptions: { background } },
  },
  images: ['src/web/public/icon.svg'],
});
