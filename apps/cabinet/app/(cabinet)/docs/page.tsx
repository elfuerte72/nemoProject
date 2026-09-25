import { Fragment, type ReactNode } from 'react';
import Link from 'next/link';
import { allowedHere } from '@/lib/access';
import { loadApiDoc, type DocOperation } from '@/lib/openapi';
import { viewer } from '@/lib/reads';
import { V1_ERROR_CODES, V1_ERRORS, V1_RESPONSE_HEADERS } from '@/lib/v1/reference';
import { DisabledBanner } from '@/app/ui/disabled-banner';
import { NoAccess } from '@/app/ui/no-access';

export const dynamic = 'force-dynamic';

/**
 * Документация API — страница из файла OpenAPI (`docs/api/merchant-v1.yaml`).
 *
 * Рисуется своими деталями, а не чужим виджетом: сторонний скрипт с
 * чужого домена на рабочем месте мерчанта закрыт чаще, чем кажется, а
 * договор невелик — девять операций. Тест сверяет файл с маршрутами,
 * поэтому страница не отстаёт от кода.
 *
 * Коды ошибок и заголовки ответа — таблицами, как у Love&Pay v2:
 * разработчик приходит сюда с кодом из ответа и ищет его, а не читает
 * абзацы. Таблицы — из `lib/v1/reference.ts`, и тест сверяет их с
 * договором.
 */
export default async function DocsPage() {
  const access = await allowedHere('/docs');
  if (!access.ok) return <NoAccess ability={access.ability} />;

  const { session } = await viewer();
  const doc = loadApiDoc();
  const baseUrl = (process.env.CABINET_URL ?? '').replace(/\/+$/, '');

  return (
    <main className="page page--wide">
      <DisabledBanner status={session.status} />

      <header className="page__head">
        <div>
          <h1 className="page__title">Документация</h1>
          <p className="page__sub">
            {doc.title}. Адрес: <span className="mono">{baseUrl || ''}/api/v1</span>. Файл
            OpenAPI — <a className="who__link" href="/api/docs/openapi.yaml">merchant-v1.yaml</a>.
          </p>
        </div>
      </header>

      <section className="card">
        <h2 className="card__title">Как устроено</h2>
        {paragraphs(doc.intro)}
        <p className="op__text">
          Пример запроса на Node.js, Python, PHP и curl — в разделе{' '}
          <Link className="who__link" href="/keys">
            «API»
          </Link>
          ; с включённой подписью он подписывает запрос. Что менялось в договоре — в{' '}
          <Link className="who__link" href="/changelog">
            «Изменениях API»
          </Link>
          .
        </p>
      </section>

      <div className="duo">
        <section className="card">
          <h2 className="card__title">Коды ошибок</h2>
          <table className="reftable">
            <thead>
              <tr>
                <th scope="col">Код</th>
                <th scope="col">Что значит и что делать</th>
              </tr>
            </thead>
            <tbody>
              {V1_ERROR_CODES.map((code) => (
                <tr key={code}>
                  <td className="mono">
                    {V1_ERRORS[code].status}
                    <br />
                    {code}
                  </td>
                  <td>
                    {V1_ERRORS[code].meaning}
                    <span className="reftable__action">{V1_ERRORS[code].action}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="card">
          <h2 className="card__title">Заголовки ответа</h2>
          <table className="reftable">
            <thead>
              <tr>
                <th scope="col">Заголовок</th>
                <th scope="col">Что в нём</th>
              </tr>
            </thead>
            <tbody>
              {V1_RESPONSE_HEADERS.map((header) => (
                <tr key={header.name}>
                  <td className="mono">{header.name}</td>
                  <td>{header.meaning}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="card__note">
            Остаток предела приходит в ответах, где ключ действует и адрес разрешён;
            x-request-id — в каждом ответе API, даже на отказ без ключа.
          </p>
        </section>
      </div>

      {doc.tags.map((tag) => (
        <section key={tag.name} className="section">
          <div className="section__head">
            <h2 className="section__title">{tag.description}</h2>
            <span className="section__rule" />
          </div>
          {doc.operations
            .filter((one) => one.tag === tag.name)
            .map((operation) => (
              <Operation key={`${operation.method} ${operation.path}`} operation={operation} />
            ))}
        </section>
      ))}
    </main>
  );
}

function Operation({ operation }: { readonly operation: DocOperation }) {
  return (
    <details className="op">
      <summary className="op__head">
        <span className={`op__method op__method--${operation.method.toLowerCase()}`}>
          {operation.method}
        </span>
        <span className="op__path mono">{operation.path}</span>
        <span className="op__summary">{operation.summary}</span>
      </summary>
      <div className="op__body">
        {operation.description ? paragraphs(operation.description) : undefined}

        {operation.parameters.length > 0 ? (
          <div className="op__block">
            <h3 className="op__title">Параметры</h3>
            <dl className="op__params">
              {operation.parameters.map((parameter) => (
                <Fragment key={`${parameter.where}:${parameter.name}`}>
                  <dt className="mono">
                    {parameter.name}
                    <span className="muted"> · {WHERE[parameter.where] ?? parameter.where}</span>
                    {parameter.required ? <span className="op__required"> обязателен</span> : undefined}
                  </dt>
                  <dd>{parameter.description ? inline(parameter.description) : '—'}</dd>
                </Fragment>
              ))}
            </dl>
          </div>
        ) : undefined}

        {operation.requestExample !== undefined ? (
          <div className="op__block">
            <h3 className="op__title">Тело запроса</h3>
            <pre className="code">
              <code>{JSON.stringify(operation.requestExample, null, 2)}</code>
            </pre>
          </div>
        ) : undefined}

        {operation.responses.map((response) => (
          <div key={response.status} className="op__block">
            <h3 className="op__title">
              <span className="mono">{response.status}</span> · {response.description}
            </h3>
            {response.example !== undefined ? (
              <pre className="code">
                <code>{JSON.stringify(response.example, null, 2)}</code>
              </pre>
            ) : undefined}
          </div>
        ))}
      </div>
    </details>
  );
}

const WHERE: Record<string, string> = {
  query: 'в строке запроса',
  path: 'в пути',
  header: 'заголовок',
};

/** Абзацы описания — по пустой строке; строки внутри абзаца склеиваются. */
function paragraphs(text: string): ReactNode {
  return text
    .split(/\n\s*\n/)
    .map((block) => block.replace(/\s*\n\s*/g, ' ').trim())
    .filter(Boolean)
    .map((block, index) => (
      <p key={index} className="op__text">
        {inline(block)}
      </p>
    ));
}

/** Обратные кавычки — кодом: единственная разметка, которая в договоре есть. */
function inline(text: string): ReactNode {
  return text.split(/(`[^`]+`)/).map((part, index) =>
    part.startsWith('`') && part.endsWith('`') ? (
      <code key={index} className="mono op__code">
        {part.slice(1, -1)}
      </code>
    ) : (
      <Fragment key={index}>{part}</Fragment>
    ),
  );
}
