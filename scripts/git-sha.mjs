import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Коммит, из которого идёт сборка, — без бинарника git.
 *
 * Читается на сборке из `next.config.ts` обоих приложений и уходит в
 * `APP_VERSION`, который отдаёт `/api/health`. Git в образе не нужен:
 * `.git/HEAD` называет ветку, ветка лежит либо отдельным файлом в
 * `refs/heads`, либо строкой в `packed-refs` — так после `git clone`
 * оказывается и то и другое, и мелкий клон Dokploy не исключение.
 *
 * Сам каталог `.git` в контекст сборки не попадает — `.dockerignore`
 * пропускает ровно эти три пути. Нет ни одного из них — версии нет, и
 * это честный `null`, а не поломка сборки.
 */
export function gitSha(root) {
  const read = (...parts) => readFileSync(join(root, '.git', ...parts), 'utf8').trim();
  const isSha = (value) => /^[0-9a-f]{40}$/.test(value);
  try {
    const head = read('HEAD');
    if (isSha(head)) return head;
    const ref = head.replace(/^ref:\s*/, '');
    try {
      const loose = read(ref);
      if (isSha(loose)) return loose;
    } catch {
      // Ссылки нет отдельным файлом — ищем в упакованных.
    }
    for (const line of read('packed-refs').split('\n')) {
      const [sha, name] = line.split(' ');
      if (name === ref && isSha(sha)) return sha;
    }
  } catch {
    // Нет `.git` вовсе — сборка вне репозитория.
  }
  return null;
}
