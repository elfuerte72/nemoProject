import { Fragment } from 'react';
import Link from 'next/link';
import { WEBHOOK_EVENT_LABELS } from '@nemo/types';
import {
  SIGNATURE_EXAMPLES,
  WEBHOOK_BODY_FIELDS,
  WEBHOOK_CHECKLIST,
  WEBHOOK_EVENT_EXAMPLES,
  WEBHOOK_GUIDE_RULES,
  WEBHOOK_HEADERS,
} from '@/lib/webhook-guide';
import { viewer } from '@/lib/reads';
import { DisabledBanner } from '@/app/ui/disabled-banner';
import { SignatureExamples } from './signature-examples';

export const dynamic = 'force-dynamic';

/**
 * «Как встроить вебхук» — правила и примеры для того, кто пишет
 * приёмник.
 *
 * Отдельной страницей, а не блоком в разделе «Вебхуки»: там рабочий
 * экран с точками и доставками, и руководство на четыре экрана
 * похоронило бы под собой журнал, ради которого раздел и открывают.
 * Договор API рядом отвечает на «что можно спросить», а эта страница —
 * на «что мне придёт и что с этим делать»: OpenAPI такого не
 * объясняет, и до сих пор объяснял это разработчику мерчанта наш
 * человек.
 *
 * Числа, заголовки и тела приезжают из `lib/webhook-guide.ts`, а он
 * берёт их у ядра: примеры на этой странице не набраны руками и потому
 * не расходятся с тем, что уходит на самом деле.
 */
export default async function WebhookGuidePage() {
  const { session } = await viewer();

  return (
    <main className="page page--wide">
      <DisabledBanner status={session.status} />

      <header className="page__head">
        <div>
          <h1 className="page__title">Как встроить вебхук</h1>
          <p className="page__sub">
            Что придёт, как проверить подпись и что ответить. Адреса и журнал доставок —{' '}
            <Link className="who__link" href="/webhooks">
              в разделе «Вебхуки»
            </Link>
            .
          </p>
        </div>
      </header>

      <section className="card">
        <h2 className="card__title">Что приходит</h2>
        <p className="op__text">
          На адрес вашей точки уходит <code className="mono op__code">POST</code> с телом JSON —
          по одному запросу на событие. Тело тонкое: в нём нет ни сумм, ни реквизитов, потому что
          журнал доставок на чужом сервере им не место. Подробности заявки забирают по её номеру
          через API.
        </p>

        <h3 className="op__title">Заголовки запроса</h3>
        <dl className="op__params">
          {WEBHOOK_HEADERS.map((header) => (
            <Fragment key={header.name}>
              <dt className="mono">
                {header.name}
                {header.value ? <span className="muted"> · {header.value}</span> : undefined}
              </dt>
              <dd>{header.detail}</dd>
            </Fragment>
          ))}
        </dl>

        <h3 className="op__title">Поля тела</h3>
        <dl className="op__params">
          {WEBHOOK_BODY_FIELDS.map((field) => (
            <Fragment key={field.name}>
              <dt className="mono">
                {field.name}
                <span className="muted"> · {field.type}</span>
              </dt>
              <dd>{field.detail}</dd>
            </Fragment>
          ))}
        </dl>
      </section>

      <section className="section">
        <div className="section__head">
          <h2 className="section__title">Проверка подписи</h2>
          <span className="section__rule" />
        </div>
        <div className="card">
          <p className="op__text">
            Считайте <code className="mono op__code">HMAC-SHA256</code> секрета точки от{' '}
            <b>сырого тела запроса</b>, до разбора JSON, и сравнивайте с заголовком{' '}
            <code className="mono op__code">x-webhook-signature</code> функцией постоянного
            времени. Тело, пересобранное из разобранного объекта, даёт другую подпись при верном
            секрете: порядок ключей и пробелы в нём уже не те. На этом спотыкаются чаще всего.
          </p>
          <SignatureExamples examples={SIGNATURE_EXAMPLES} />
        </div>
      </section>

      <section className="section">
        <div className="section__head">
          <h2 className="section__title">Правила</h2>
          <span className="section__rule" />
        </div>
        <div className="guide__rules">
          {WEBHOOK_GUIDE_RULES.map((rule) => (
            <article key={rule.title} className="card guide__rule">
              <h3 className="card__title">{rule.title}</h3>
              <p className="op__text">{rule.detail}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="section">
        <div className="section__head">
          <h2 className="section__title">Тело события по видам</h2>
          <span className="section__rule" />
        </div>
        <p className="op__text">
          Тела показаны байт в байт — одной строкой, без отступов, ровно так, как они уходят и как
          от них считается подпись. Разложенный по строкам JSON читался бы удобнее, но списанный с
          него в проверку подписи он бы её и не дал.
        </p>
        {WEBHOOK_EVENT_EXAMPLES.map((example) => (
          <details key={example.event} className="op">
            <summary className="op__head">
              <span className="op__path mono">{example.event}</span>
              <span className="op__summary">{WEBHOOK_EVENT_LABELS[example.event]}</span>
            </summary>
            <div className="op__body">
              <pre className="code code--wrap">
                <code>{example.body}</code>
              </pre>
            </div>
          </details>
        ))}
      </section>

      <section className="section">
        <div className="section__head">
          <h2 className="section__title">Что учесть</h2>
          <span className="section__rule" />
        </div>
        <div className="guide__rules">
          {WEBHOOK_CHECKLIST.map((item) => (
            <article key={item.title} className="card guide__rule">
              <h3 className="card__title">{item.title}</h3>
              <p className="op__text">{item.detail}</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
