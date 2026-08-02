import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/auth.ts', 'src/configuration/**/*.ts', 'src/env.ts', 'src/policy/engine.ts'],
      thresholds: { lines: 80, functions: 80, statements: 80, branches: 75 }
    }
  }
});
