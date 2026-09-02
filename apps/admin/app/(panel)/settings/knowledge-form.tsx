'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { KnowledgeArticleView } from '@nemo/core';

/**
 * База знаний помощника.
 *
 * Здесь администратор правит то, что помощник знает о сервисе: график,
 * банки, сроки, чего сервис не делает. Голос помощника ему не отдан —
 * характер и запреты живут в коде и проходят ревью; одно неверное слово
 * в поле меняло бы поведение у всех клиентов сразу и без отката.
 *
 * Порядок статей виден и правится: справку модель читает сверху вниз, и
 * начало запроса весит больше конца — наверх ставят то, что спрашивают
 * чаще.
 */
export function KnowledgeForm({ articles }: { articles: readonly KnowledgeArticleView[] }) {
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  /** Какую статью правят. Пусто — заводят новую. */
  const [editing, setEditing] = useState<KnowledgeArticleView | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [position, setPosition] = useState('0');

  function startNew() {
    setEditing(null);
    setTitle('');
    setBody('');
    setPosition('0');
  }

  function startEditing(article: KnowledgeArticleView) {
    setEditing(article);
    setTitle(article.title);
    setBody(article.body);
    setPosition(String(article.position));
  }

  async function send(method: 'POST' | 'PATCH', payload: unknown) {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const response = await fetch('/api/concierge/knowledge', {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const answer = (await response.json()) as { error?: string };
        setError(answer.error ?? 'Не сохранилось');
        return;
      }
      startNew();
      router.refresh();
    } catch {
      setError('Не удалось связаться с сервером. Повторите попытку.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <h2 className="card__title">Что помощник знает о сервисе</h2>
      <p className="card__note">
        Факты, по которым помощник отвечает клиентам: график, банки, сроки, чего
        сервис не делает. Чего здесь нет, того он не скажет — на такой вопрос он
        позовёт менеджера. Наверх ставьте то, о чём спрашивают чаще.
      </p>

      {error ? <p className="error">{error}</p> : undefined}

      <div className="form-row">
        <label className="field field--wide">
          <span className="label">Название</span>
          <input
            className="input"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Например: сроки перевода"
          />
        </label>
        <label className="field">
          <span className="label">Порядок</span>
          <input
            className="input"
            value={position}
            onChange={(event) => setPosition(event.target.value)}
            inputMode="numeric"
          />
        </label>
      </div>
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
          disabled={busy || title.trim() === '' || body.trim() === ''}
          onClick={() =>
            void send('POST', {
              ...(editing ? { id: editing.id } : {}),
              title: title.trim(),
              body: body.trim(),
              position: Number(position) || 0,
            })
          }
        >
          {busy ? 'Сохраняю…' : editing ? 'Сохранить статью' : 'Добавить статью'}
        </button>
        {editing ? (
          <button type="button" className="btn btn--ghost" onClick={startNew}>
            Отменить правку
          </button>
        ) : undefined}
      </div>

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
                  onClick={() => startEditing(article)}
                >
                  Править
                </button>
                <button
                  type="button"
                  className="btn btn--ghost"
                  disabled={busy}
                  onClick={() =>
                    void send('PATCH', { id: article.id, isActive: !article.isActive })
                  }
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
