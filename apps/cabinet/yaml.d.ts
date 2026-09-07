/**
 * Файл YAML приходит строкой: сборщик кладёт его в бандл как текст
 * (`asset/source` в `next.config.ts`), и на диске в контейнере его
 * искать не нужно.
 */
declare module '*.yaml' {
  const source: string;
  export default source;
}
