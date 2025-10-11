import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    deps: {
      fallbackCJS: true,
      inline: ['multer']
    }
  },
  ssr: {
    external: ['multer']
  }
});
