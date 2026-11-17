import { defineConfig } from 'vitest/config';

const chromeTests = [
  'src/core/gig-card-layout.test.ts',
  'src/world/viewer/chrome-profile.test.ts',
  // Include this CI smoke test automatically if it lands on main.
  'src/core/browser-smoke.test.ts',
];

export default defineConfig({
  test: {
    environment: 'node',
    testTimeout: 20000,
    projects: [
      {
        test: {
          name: 'unit',
          include: ['src/**/*.test.ts'],
          exclude: chromeTests,
        },
      },
      {
        test: {
          name: 'chrome',
          include: chromeTests,
          pool: 'forks',
          fileParallelism: false,
          poolOptions: { forks: { singleFork: true } },
          testTimeout: 420000,
          hookTimeout: 60000,
        },
      },
    ],
  },
});
