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

  /*
   * Файл уходит в Telegram раньше записи в переписку, и маршрут, у которого
   * упала запись, говорит, что файл уже у клиента. Прочитанный как отказ,
   * такой ответ оставлял файл в поле — и следующее «Отправить» слало клиенту
   * тот же чек вторым (ревью 17 сентября 2026).
   */
  it('файл дошёл, а запись упала — отправлен, и слова маршрута остаются', async () => {
    const said = 'Файл клиенту ушёл, но в переписку не записался.';
    const outcome = await sendOutcome(
      answer(500, JSON.stringify({ error: said, delivered: true })),
      refused,
    );
    expect(outcome).toEqual({ sent: true, notice: said });
  });

  it('признак доставки без слов — отправлен, со словами экрана', async () => {
    expect(await sendOutcome(answer(500, '{"delivered":true}'), refused)).toEqual({
      sent: true,
      notice: refused,
    });
  });

  it('оборванная сеть — не отправлен, и сказано, что сервер не ответил', async () => {
    const offline = () => Promise.reject(new TypeError('Failed to fetch'));
    expect(await sendOutcome(offline, refused)).toEqual({ sent: false, complaint: NO_CONNECTION });
  });
});
