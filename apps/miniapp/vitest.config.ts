import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Тем же псевдонимом путей, каким собирается приложение (`@/*` из
 * `tsconfig.json`). Без него в тест не втащить модуль, который ходит за
 * соседями через `@/`, — а бот ходит: за ядром, за ссылкой на реферала,
 * за толчком панели.
 */
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('.', import.meta.url)).replace(/\/$/, '') },
  },
});
