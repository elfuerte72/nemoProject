import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: ['./src/test-setup.ts'],
    // Тестовая база одна на всех: параллельные файлы вычищали бы данные
    // друг у друга.
    fileParallelism: false,
  },
});
