/**
 * Первое значение параметра адреса.
 *
 * Next отдаёт `searchParams` строкой или списком строк — список, когда
 * параметр повторён. Экранам нужен один: повторённый `period` в адресе
 * — опечатка, а не выбор двух периодов. Пустое после обрезки — как
 * будто параметра не было.
 */
export function firstParam(value: string | string[] | undefined): string | undefined {
  const one = Array.isArray(value) ? value[0] : value;
  return one?.trim() || undefined;
}
