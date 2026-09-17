import { describe, expect, it } from 'vitest';
import { NO_CONNECTION, sendOutcome } from './send-outcome';

/**
 * Чем кончилась отправка клиенту.
 *
 * По исходу поле ответа решает, пустеть ли ему. До 17 сентября 2026
 * отказ здесь не различался вовсе: ответ, не дошедший до сервера, стирал
 * набранное так же, как дошедший, — а отказ печатался над лентой, на
 * телефоне выше экрана.
 */

const refused = 'Ответ не отправлен';

function answer(status: number, body: string): () => Promise<Response> {
  return () => Promise.resolve(new Response(body, { status }));
}

describe('исход отправки клиенту', () => {
  it('принятый ответ — отправлен', async () => {
    expect(await sendOutcome(answer(201, '{"message":{}}'), refused)).toEqual({ sent: true });
  });

  it('отказ сервера — не отправлен, и называет его слова', async () => {
    const outcome = await sendOutcome(answer(401, '{"error":"Требуется вход"}'), refused);
    expect(outcome).toEqual({ sent: false, complaint: 'Требуется вход' });
  });

  it('отказ без слов — не отправлен, со словами экрана', async () => {
    expect(await sendOutcome(answer(502, '<html>Bad Gateway</html>'), refused)).toEqual({
      sent: false,
      complaint: refused,
    });
    expect(await sendOutcome(answer(500, '{}'), refused)).toEqual({
      sent: false,
      complaint: refused,
    });
  });

  it('оборванная сеть — не отправлен, и сказано, что сервер не ответил', async () => {
    const offline = () => Promise.reject(new TypeError('Failed to fetch'));
    expect(await sendOutcome(offline, refused)).toEqual({ sent: false, complaint: NO_CONNECTION });
  });
});
