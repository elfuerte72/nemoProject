/**
 * Пример запроса — с хвостом настоящего ключа мерчанта: чужой пример
 * копируют вместе с чужим ключом, свой — узнают. Сам ключ сюда не
 * попадает: его нет и у нас.
 *
 * Строкой в коде, а не в документации: пример правится вместе с
 * подписью, и разъехаться им негде.
 */
export function UsageExample({
  baseUrl,
  keyHint,
  signatureRequired,
}: {
  readonly baseUrl: string;
  readonly keyHint: string | null;
  readonly signatureRequired: boolean;
}) {
  const origin = baseUrl || 'https://<домен кабинета>';
  const hint = keyHint ?? 'sk_live_…';

  const plain = `const KEY = process.env.TOBEE_API_KEY; // ${hint}

const response = await fetch('${origin}/api/v1/quote', {
  method: 'POST',
  headers: {
    authorization: \`Bearer \${KEY}\`,
    'content-type': 'application/json',
  },
  body: JSON.stringify({ from: 'USDT', to: 'RUB', amount: '100', side: 'from' }),
});
const { quote } = await response.json();
// quote.rate, quote.to.amount, quote.quotedAt — отметка для подачи`;

  const signed = `import { createHash, createHmac } from 'node:crypto';

const KEY = process.env.TOBEE_API_KEY; // ${hint}
// У GET путь подписывается вместе со строкой запроса:
// '/api/v1/exchange-requests?limit=50', а тело — пустая строка.
const path = '/api/v1/quote';
const body = JSON.stringify({ from: 'USDT', to: 'RUB', amount: '100', side: 'from' });
const timestamp = String(Math.floor(Date.now() / 1000));

const digest = createHash('sha256').update(body).digest('hex');
const signature = createHmac('sha256', KEY)
  .update(['POST', path, timestamp, digest].join('\\n'))
  .digest('hex');

const response = await fetch('${origin}' + path, {
  method: 'POST',
  headers: {
    'x-api-key': KEY,
    'x-timestamp': timestamp,
    'x-signature': signature,
    'content-type': 'application/json',
  },
  body,
});`;

  return (
    <section className="card">
      <h2 className="card__title">Пример на Node.js</h2>
      <p className="card__note">
        {signatureRequired
          ? 'Подпись включена, поэтому пример подписывает запрос. У GET тело пустое — хешируется пустая строка; путь берётся вместе со строкой запроса.'
          : 'Ключ — в заголовке Authorization. Подача заявки устроена так же: POST /api/v1/exchange-requests с заголовком Idempotency-Key.'}
      </p>
      <pre className="code">
        <code>{signatureRequired ? signed : plain}</code>
      </pre>
    </section>
  );
}
