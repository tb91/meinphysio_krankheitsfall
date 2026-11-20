import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    // Domänentests laufen gegen fixe Zeitzone, unabhängig vom Rechner.
    env: { TZ: 'UTC' },
  },
});
