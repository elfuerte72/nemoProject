import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Тем же псевдонимом путей, каким собирается приложение (`@/*` из
 * `tsconfig.json`). Без него в тест не втащить модуль, который ходит за
 * соседями через `@/`, — а бот ходит: за ядром, за ссылкой на реферала,
 * за толчком панели.
 */
export default defineConfig({
  plugins: [
    /*
     * Файл YAML — строкой, как его кладёт в бандл правило `asset/source`
     * в `next.config.ts`: тест договора читает тот же модуль, что и
     * страница «Документация».
     */
    {
      name: 'yaml-as-source',
      transform(code, id) {
        if (!/\.ya?ml$/.test(id)) return null;
        return { code: `export default ${JSON.stringify(code)};`, map: null };
      },
    },
  ],
  resolve: {
    alias: { '@': fileURLToPath(new URL('.', import.meta.url)).replace(/\/$/, '') },
  },
});
