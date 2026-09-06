'use client';

/**
 * Запрос к своему маршруту из формы.
 *
 * Один на все формы кабинета: их шесть, и у всех одно и то же — отдать
 * JSON, дождаться ответа, показать слова отказа. Слова эти приходят от
 * ядра (`{ error }` из `@nemo/http`), а не сочиняются экраном: правило
 * живёт в операции, и пересказ его в разметке разошёлся бы с ним при
 * первой правке.
 */
export async function send(
  path: string,
  body: unknown,
): Promise<{ ok: true; data: unknown } | { ok: false; complaint: string }> {
  try {
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data: unknown = await response.json().catch(() => ({}));
    if (!response.ok) {
      const complaint =
        typeof data === 'object' && data !== null && 'error' in data
          ? String((data as { error: unknown }).error)
          : 'Не получилось. Попробуйте ещё раз.';
      return { ok: false, complaint };
    }
    return { ok: true, data };
  } catch {
    // Сеть, которой нет: сказать об этом надо тем же способом, что и об
    // отказе, — иначе форма молча замирает на нажатой кнопке.
    return { ok: false, complaint: 'Сеть недоступна. Попробуйте ещё раз.' };
  }
}
