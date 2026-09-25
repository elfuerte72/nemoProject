'use client';

import { useRef, useState } from 'react';
import type { CodeExample } from '@/lib/webhook-guide';

/**
 * Пример кода с переключателем языков: проверка подписи вебхука в «Как
 * встроить», подпись запроса на странице «API».
 *
 * Клиентским компонентом, а не тремя блоками подряд: три листинга
 * одного и того же уводят взгляд, а разработчик читает свой. Выбор в
 * адрес не выносится — он ничего не сужает и с сервера ничего не
 * просит, в отличие от табов состояния над списком.
 *
 * Переключатель набран настоящими табами, а не рядом кнопок: раз уж
 * `role="tab"` обещает диктору «вкладка 1 из 3», он обязан обещать и
 * остальное — стрелки между вкладками, один Tab на весь ряд и панель,
 * на которую вкладка указывает. Ряд ссылок из `@nemo/ui` здесь не
 * подходит: там выбор живёт в адресе, а тут он ничего не меняет за
 * пределами блока.
 */
export function CodeExamples({
  examples,
  id,
}: {
  readonly examples: readonly CodeExample[];
  /** Начало идентификаторов вкладок: панель ссылается на свою вкладку по нему. */
  readonly id: string;
}) {
  const [language, setLanguage] = useState(examples[0]?.language);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const chosen = examples.find((one) => one.language === language) ?? examples[0];
  if (!chosen) return null;

  const move = (from: number, step: number) => {
    const to = (from + step + examples.length) % examples.length;
    setLanguage(examples[to]!.language);
    tabs.current[to]?.focus();
  };

  return (
    <>
      <div className="tabs" role="tablist" aria-label="Язык примера">
        {examples.map((example, index) => {
          const current = example.language === chosen.language;
          return (
            <button
              key={example.language}
              ref={(node) => {
                tabs.current[index] = node;
              }}
              type="button"
              role="tab"
              id={`${id}-tab-${example.language}`}
              aria-selected={current}
              aria-controls={`${id}-panel-${chosen.language}`}
              // Один Tab на весь ряд: внутрь ряда ведут стрелки, а
              // следующий Tab уносит к самому листингу.
              tabIndex={current ? 0 : -1}
              className={current ? 'tab tab--on' : 'tab'}
              onClick={() => setLanguage(example.language)}
              onKeyDown={(event) => {
                if (event.key === 'ArrowRight') move(index, 1);
                else if (event.key === 'ArrowLeft') move(index, -1);
                else return;
                event.preventDefault();
              }}
            >
              {example.label}
            </button>
          );
        })}
      </div>
      <pre
        className="code"
        role="tabpanel"
        id={`${id}-panel-${chosen.language}`}
        aria-labelledby={`${id}-tab-${chosen.language}`}
        // Листинг прокручивается вбок, и добраться до прокрутки нужно с
        // клавиатуры тоже.
        tabIndex={0}
      >
        <code>{chosen.code}</code>
      </pre>
    </>
  );
}
