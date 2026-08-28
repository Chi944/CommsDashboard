import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.jsx'],
    exclude: ['**/.worktrees/**', '**/node_modules/**'],
  },
});
