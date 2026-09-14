import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    exclude: [
      'src/hooks/__tests__/useAttendance.test.ts',
      'src/hooks/__tests__/usePosts.test.ts',
      'src/hooks/__tests__/useProfileStatus.test.ts',
      'src/hooks/__tests__/useSchedule.test.ts',
    ],
    environment: 'node',
    passWithNoTests: true,
  },
})
