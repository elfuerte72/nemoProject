'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { DraftedArticleView, KnowledgeArticleView } from '@nemo/core';
import { normalizeKnowledgeTitle } from '@nemo/types';
import { KNOWLEDGE_FILE_ACCEPT } from '@/lib/knowledge-file-kinds';

/**
 * База знаний помощника.
 *
 * Здесь администратор правит то, что помощник знает о сервисе: график,
 * банки, сроки, чего сервис не делает. Голос помощника ему не отдан —
 * характер и запреты живут в коде и проходят ревью; одно неверное слово
 * в поле меняло бы поведение у всех клиентов сразу и без отката.
 *
 * Знания приносят документом: регламент, памятку, ответы на частые
 * вопросы — файлом или текстом. Помощник делит документ на статьи и
 * показывает их черновиком; в черновике каждую можно поправить или
 * убрать, и запишется только то, что осталось. До 5 сентября 2026 форма
 * просила название, порядок и текст по одной статье, и читалась как
 * обучение агента, а поле «Порядок» не понимал никто. Порядок теперь
 * не спрашивается: новая статья встаёт в конец справки.
 *
 * Статья руками осталась вторым путём — на одну поправку заводить
 * документ незачем, а без ключа провайдера это путь единственный.
 */

/** Статья черновика на экране: то же, что отдало ядро, плюс ключ для списка. */
interface DraftItem extends DraftedArticleView {
  readonly key: number;
}

type Busy = 'draft' | 'save' | 'edit' | null;

export function KnowledgeForm({
  articles,
  canDraft,
}: {
  articles: readonly KnowledgeArticleView[];
  /** Есть ли у панели провайдер, который разбирает документы. */
  canDraft: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [done, setDone] = useState<string>();
  const [busy, setBusy] = useState<Busy>(null);

  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);

  const [draft, setDraft] = useState<readonly DraftItem[] | null>(null);
  const [truncated, setTruncated] = useState(false);

  /** Какую статью правят руками. `'new'` — пишут новую. */
  const [editing, setEditing] = useState<KnowledgeArticleView | 'new' | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');

  async function request<T>(url: string, init: RequestInit, kind: Busy): Promise<T | null> {
    if (busy) return null;
    setBusy(kind);
    setError(undefined);
    setDone(undefined);
    try {
      const response = await fetch(url, init);
      const answer = (await response.json()) as T & { error?: string };
      if (!response.ok) {
        setError(answer.error ?? 'Не получилось');
        return null;
      }
      return answer;
    } catch {
      setError('Не удалось связаться с сервером. Повторите попытку.');
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function draftFromDocument() {
    // Файл — multipart, текст — JSON: маршрут один, вход разный.
    const form = new FormData();
    if (file) form.append('file', file);
    const init: RequestInit = file
      ? { method: 'POST', body: form }
      : {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text }),
        };
    const answer = await request<{
      draft: { articles: readonly DraftedArticleView[]; truncated: boolean };
    }>('/api/concierge/knowledge/draft', init, 'draft');
    if (!answer) return;

    setDraft(answer.draft.articles.map((article, key) => ({ ...article, key })));
    setTruncated(answer.draft.truncated);
    setText('');
    setFile(null);
  }

  async function saveDraft() {
    if (!draft) return;
    const answer = await request<{ articles: readonly KnowledgeArticleView[] }>(
      '/api/concierge/knowledge/batch',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          articles: draft.map(({ title: one, body: two }) => ({ title: one, body: two })),
        }),
      },
      'save',
    );
    if (!answer) return;

    setDraft(null);
    setDone(`Записано: ${sayArticles(answer.articles.length)}. Помощник уже отвечает по ним.`);
    router.refresh();
  }

  function patchDraft(key: number, patch: Partial<Pick<DraftItem, 'title' | 'body'>>) {
    setDraft((current) =>
      current?.map((item) => (item.key === key ? { ...item, ...patch } : item)) ?? null,
    );
  }

  function dropFromDraft(key: number) {
    setDraft((current) => current?.filter((item) => item.key !== key) ?? null);
  }

  function startEditing(article: KnowledgeArticleView | 'new') {
    setEditing(article);
    setTitle(article === 'new' ? '' : article.title);
    setBody(article === 'new' ? '' : article.body);
    // Отказ и отчёт прошлого шага — не про эту форму.
    setError(undefined);
    setDone(undefined);
  }

  function stopEditing() {
    setEditing(null);
    setTitle('');
    setBody('');
  }

  async function saveEdited() {
    const answer = await request<{ article: KnowledgeArticleView }>(
      '/api/concierge/knowledge',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...(editing && editing !== 'new' ? { id: editing.id } : {}),
          title: title.trim(),
          body: body.trim(),
        }),
      },
      'edit',
    );
    if (!answer) return;
    stopEditing();
    router.refresh();
  }

  async function toggle(article: KnowledgeArticleView) {
    const answer = await request(
      '/api/concierge/knowledge',
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: article.id, isActive: !article.isActive }),
      },
      'edit',
    );
    if (answer) router.refresh();
  }

  const canSubmitDocument = busy === null && (file !== null || text.trim() !== '');

  /**
   * Какую статью заменит эта: одноимённую, тем же правилом, что и
   * запись. Считается по живому названию, а не по ответу ядра: название
   * в черновике правят, и сказанное при разборе устарело бы на первой
   * же правке.
   */
  function replacedBy(draftTitle: string): KnowledgeArticleView | undefined {
    const key = normalizeKnowledgeTitle(draftTitle);
    return key === '' ? undefined : articles.find((one) => normalizeKnowledgeTitle(one.title) === key);
  }

  return (
    <section className="card">
      <h2 className="card__title">Что помощник знает о сервисе</h2>
      <p className="card__note">
        Факты, по которым помощник отвечает клиентам: график, банки, сроки, чего
        сервис не делает. Чего здесь нет, того он не скажет — на такой вопрос он
        позовёт менеджера. Принесите документ — регламент, памятку, ответы на
        частые вопросы, — и помощник разберёт его на статьи. Запишется только то,
        что вы подтвердите.
      </p>

      {error ? <p className="error">{error}</p> : undefined}
      {done ? <p className="muted">{done}</p> : undefined}

      {draft === null && editing === null ? (
        canDraft ? (
          <div className="intake">
            <label className="field field--wide">
              <span className="label">Текст документа</span>
              <textarea
                className="input"
                rows={5}
                value={text}
                disabled={file !== null || busy !== null}
                onChange={(event) => setText(event.target.value)}
                placeholder="Вставьте как есть: регламент, памятку, ответы на вопросы клиентов"
              />
            </label>
            <div className="row__actions">
              <label className={`btn btn--soft${busy ? ' btn--disabled' : ''}`}>
                {file ? 'Выбрать другой файл' : 'Выбрать файл'}
                <input
                  type="file"
                  className="sr-only"
                  accept={KNOWLEDGE_FILE_ACCEPT}
                  disabled={busy !== null}
                  onChange={(event) => {
                    setFile(event.target.files?.[0] ?? null);
                    // Тот же файл, выбранный снова, иначе не вызвал бы
                    // событие: поле помнит прошлый выбор.
                    event.target.value = '';
                  }}
                />
              </label>
              {file ? (
                <span className="intake__file">
                  {file.name}
                  <button
                    type="button"
                    className="btn btn--ghost btn--tiny"
                    aria-label="Убрать файл"
                    disabled={busy !== null}
                    onClick={() => setFile(null)}
                  >
                    ×
                  </button>
                </span>
              ) : (
                <span className="muted">PDF, DOCX или текстовый файл до 10 МБ</span>
              )}
              <button
                type="button"
                className="btn btn--gold intake__submit"
                disabled={!canSubmitDocument}
                onClick={() => void draftFromDocument()}
              >
                {busy === 'draft' ? 'Читаю документ…' : 'Разобрать на статьи'}
              </button>
            </div>
          </div>
        ) : (
          <p className="muted">
            Разбор документов выключен: у панели нет ключа провайдера модели
            (DEEPSEEK_API_KEY). Статьи пока пишутся руками.
          </p>
        )
      ) : undefined}

      {draft !== null ? (
        <div className="draft" aria-live="polite">
          <div className="draft__head">
            <span className="row__title">
              {draft.length === 0 ? 'Статей не нашлось' : `Черновик: ${sayArticles(draft.length)}`}
            </span>
            <span className="muted">
              {draft.length === 0
                ? 'В документе нет фактов о сервисе, которые пригодились бы клиенту. Попробуйте другой текст.'
                : 'Проверьте и поправьте: так помощник будет отвечать клиентам. Запишется только то, что останется в списке.'}
            </span>
          </div>
          {truncated ? (
            <p className="draft__warn">
              Документ длинный, и разобрана только его часть. Запишите эти статьи, а
              остаток документа пришлите отдельно.
            </p>
          ) : undefined}

          {draft.length > 0 ? (
            <ul className="rows">
              {draft.map((item) => {
                const replaced = replacedBy(item.title);
                return (
                  <li key={item.key} className="row row--stack">
                    <label className="field field--wide">
                      <span className="label">Название</span>
                      <input
                        className="input"
                        value={item.title}
                        disabled={busy !== null}
                        onChange={(event) => patchDraft(item.key, { title: event.target.value })}
                      />
                    </label>
                    <label className="field field--wide">
                      <span className="label">Текст</span>
                      <textarea
                        className="input"
                        rows={4}
                        value={item.body}
                        disabled={busy !== null}
                        onChange={(event) => patchDraft(item.key, { body: event.target.value })}
                      />
                    </label>
                    {replaced ? (
                      <span className="muted">
                        Заменит статью «{replaced.title}»
                        {replaced.isActive ? '' : ' и вернёт её в справку: сейчас она погашена'}.
                      </span>
                    ) : undefined}
                    {item.warnings.map((warning) => (
                      <span key={warning} className="draft__warn">
                        {warning}
                      </span>
                    ))}
                    <div className="row__actions">
                      <button
                        type="button"
                        className="btn btn--ghost btn--tiny"
                        disabled={busy !== null}
                        onClick={() => dropFromDraft(item.key)}
                      >
                        Убрать из черновика
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : undefined}

          <div className="row__actions">
            {draft.length > 0 ? (
              <button
                type="button"
                className="btn btn--gold"
                disabled={busy !== null || draft.some((item) => !item.title.trim() || !item.body.trim())}
                onClick={() => void saveDraft()}
              >
                {busy === 'save' ? 'Записываю…' : `Запомнить: ${sayArticles(draft.length)}`}
              </button>
            ) : undefined}
            <button
              type="button"
              className="btn btn--ghost"
              disabled={busy !== null}
              onClick={() => setDraft(null)}
            >
              {draft.length > 0 ? 'Отменить' : 'Назад'}
            </button>
          </div>
        </div>
      ) : undefined}

      {editing !== null ? (
        <div className="draft">
          <span className="row__title">
            {editing === 'new' ? 'Новая статья' : `Правка: ${editing.title}`}
          </span>
          <label className="field field--wide">
            <span className="label">Название</span>
            <input
              className="input"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Например: сроки перевода"
            />
          </label>
          <label className="field field--wide">
            <span className="label">Текст</span>
            <textarea
              className="input"
              rows={6}
              value={body}
              onChange={(event) => setBody(event.target.value)}
              placeholder="Пишите фактами, как ответили бы клиенту сами."
            />
          </label>
          <div className="row__actions">
            <button
              type="button"
              className="btn btn--gold"
              disabled={busy !== null || title.trim() === '' || body.trim() === ''}
              onClick={() => void saveEdited()}
            >
              {busy === 'edit' ? 'Сохраняю…' : editing === 'new' ? 'Добавить статью' : 'Сохранить статью'}
            </button>
            <button type="button" className="btn btn--ghost" onClick={stopEditing}>
              Отменить
            </button>
          </div>
        </div>
      ) : undefined}

      {draft === null && editing === null ? (
        <div className="row__actions">
          <button
            type="button"
            className="btn btn--ghost btn--tiny"
            disabled={busy !== null}
            onClick={() => startEditing('new')}
          >
            Написать статью руками
          </button>
        </div>
      ) : undefined}

      {articles.length === 0 ? (
        <p className="empty">
          Статей пока нет. Пока их нет, помощник отвечает только про курс и
          состояние заявок клиента, а на всё остальное зовёт менеджера.
        </p>
      ) : (
        <ul className="rows">
          {articles.map((article) => (
            <li key={article.id} className="row">
              <div className="row__main">
                <span className="row__title">
                  {article.title}
                  {article.isActive ? '' : ' · погашена'}
                </span>
                <span className="row__meta">{article.body.slice(0, 160)}</span>
              </div>
              <div className="row__actions">
                <button
                  type="button"
                  className="btn btn--ghost"
                  disabled={busy !== null || draft !== null}
                  onClick={() => startEditing(article)}
                >
                  Править
                </button>
                <button
                  type="button"
                  className="btn btn--ghost"
                  disabled={busy !== null}
                  onClick={() => void toggle(article)}
                >
                  {article.isActive ? 'Погасить' : 'Вернуть'}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** «1 статья», «2 статьи», «5 статей»: число с формой слова. */
function sayArticles(count: number): string {
  const last = count % 10;
  const tens = count % 100;
  const word =
    tens >= 11 && tens <= 19 ? 'статей' : last === 1 ? 'статья' : last >= 2 && last <= 4 ? 'статьи' : 'статей';
  return `${count} ${word}`;
}
