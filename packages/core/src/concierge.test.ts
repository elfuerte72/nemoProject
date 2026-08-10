import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { clientMessages } from '@nemo/db';
import { closeTestDatabase, resetDatabase, testDatabase } from '@nemo/db/testing';
import {
  CONCIERGE_HANDOVER,
  CONCIERGE_HELLO,
  CONCIERGE_HINTS,
  CONCIERGE_OFFTOPIC,
  createCore,
  type Actor,
} from './index.js';
import type { ConciergeAnswer, ConciergeSource } from './concierge-source.js';
import { givenStaff } from './test-support.js';

/**
 * Консьерж как первая линия.
 *
 * Проверяется то, ради чего он и заводится, и то, чем он опасен. Ради:
 * клиент получает ответ сразу, а не подтверждение приёма. Опасен:
 * дешёвая модель говорит про деньги — поэтому число, которого сервис не
 * называл, до клиента не доходит, а разговор, перешедший к человеку,
 * обратно к боту не возвращается.
 *
 * Модель подменена: в тест её не позовёшь, а проверяются здесь правила
 * ядра, а не её сообразительность. Ответы настоящего провайдера лежат
 * фикстурами в `@nemo/concierge`.
 */

const db = testDatabase();

/** Модель, отвечающая заданным текстом. Считает, сколько раз её звали. */
function givenModel(...answers: (ConciergeAnswer | null)[]): ConciergeSource & {
  readonly calls: { request: unknown }[];
} {
  const calls: { request: unknown }[] = [];
  let next = 0;
  return {
    calls,
    answer: async (request) => {
      calls.push({ request });
      const answer = answers[Math.min(next, answers.length - 1)];
      next += 1;
      return answer ?? null;
    },
  };
}

/**
 * Ядро с нулевой паузой накопления: тесты пишут и тут же спрашивают, а
 * ждать тишину — забота отдельных тестов паузы, где она включена явно.
 */
function coreWith(concierge: ConciergeSource | undefined) {
  return createCore({ db, conciergeQuietMs: 0, ...(concierge ? { concierge } : {}) });
}

/** Состарить всю ленту на столько-то секунд: столько прошло с написания. */
async function agedSeconds(seconds: number) {
  const rows = await db.select({ id: clientMessages.id, at: clientMessages.createdAt }).from(clientMessages);
  for (const row of rows) {
    await db
      .update(clientMessages)
      .set({ createdAt: new Date(row.at.getTime() - seconds * 1000) })
      .where(eq(clientMessages.id, row.id));
  }
}

const SIMPLE: ConciergeAnswer = {
  reply: 'Курс виден на главном экране обменника, там же подаётся заявка.',
  needsHuman: false,
};

let manager: Actor & { type: 'staff' };

beforeEach(async () => {
  await resetDatabase();
  manager = await givenStaff({ displayName: 'Пётр', telegramUserId: 901n });
});

afterAll(() => closeTestDatabase());

describe('приём сообщения при живом консьерже', () => {
  it('не отвечает подтверждением приёма: его заменяет живой ответ', async () => {
    const core = coreWith(givenModel(SIMPLE));
    await core.registerClient({ telegramUserId: 100n });

    const { notifications } = await core.receiveClientMessage({
      telegramUserId: 100n,
      body: 'Какой курс?',
    });

    expect(notifications).toEqual([]);
  });

  it('отвечает подтверждением, когда консьержа в деплое нет', async () => {
    const core = coreWith(undefined);
    await core.registerClient({ telegramUserId: 100n });

    const { notifications } = await core.receiveClientMessage({
      telegramUserId: 100n,
      body: 'Какой курс?',
    });

    expect(notifications).toEqual([
      expect.objectContaining({ kind: 'client-message-received' }),
    ]);
  });
});

describe('ответ', () => {
  it('уходит клиенту и ложится в ленту с пометкой автора', async () => {
    const core = coreWith(givenModel(SIMPLE));
    await core.registerClient({ telegramUserId: 100n });
    await core.receiveClientMessage({ telegramUserId: 100n, body: 'Какой курс?' });

    const { notifications } = await core.answerAsConcierge({ telegramUserId: 100n });

    expect(notifications).toEqual([
      expect.objectContaining({ kind: 'concierge-message', to: 100n }),
    ]);
    const feed = await core.listConversation(manager, 100n);
    expect(feed.at(-1)).toMatchObject({
      direction: 'outgoing',
      authorStaffId: null,
      byConcierge: true,
    });
  });

  it('в первом ответе представляется, а во втором — нет', async () => {
    const core = coreWith(givenModel(SIMPLE));
    await core.registerClient({ telegramUserId: 100n });

    await core.receiveClientMessage({ telegramUserId: 100n, body: 'Какой курс?' });
    const first = await core.answerAsConcierge({ telegramUserId: 100n });
    await core.receiveClientMessage({ telegramUserId: 100n, body: 'А бата?' });
    const second = await core.answerAsConcierge({ telegramUserId: 100n });

    expect(bodyOf(first)).toContain('помощник');
    expect(bodyOf(second)).not.toContain('помощник');
  });

  it('не отвечает дважды на одно сообщение', async () => {
    const core = coreWith(givenModel(SIMPLE));
    await core.registerClient({ telegramUserId: 100n });
    await core.receiveClientMessage({ telegramUserId: 100n, body: 'Какой курс?' });

    await core.answerAsConcierge({ telegramUserId: 100n });
    const again = await core.answerAsConcierge({ telegramUserId: 100n });

    expect(again.notifications).toEqual([]);
  });
});

describe('застава', () => {
  it('переспрашивает модель, назвавшую число из воздуха', async () => {
    const model = givenModel(
      { reply: 'Курс сейчас 95 рублей за USDT.', needsHuman: false },
      SIMPLE,
    );
    const core = coreWith(model);
    await core.registerClient({ telegramUserId: 100n });
    await core.receiveClientMessage({ telegramUserId: 100n, body: 'Какой курс?' });

    const result = await core.answerAsConcierge({ telegramUserId: 100n });

    expect(model.calls).toHaveLength(2);
    expect(bodyOf(result)).not.toContain('95');
  });

  it('зовёт человека, если и повтор не годится', async () => {
    const core = coreWith(
      givenModel({ reply: 'Курс сейчас 95 рублей.', needsHuman: false }),
    );
    await core.registerClient({ telegramUserId: 100n });
    await core.receiveClientMessage({ telegramUserId: 100n, body: 'Какой курс?' });

    const result = await core.answerAsConcierge({ telegramUserId: 100n });

    expect(bodyOf(result)).toBe(CONCIERGE_HANDOVER);
    expect(await isHandedToHuman(core, 100n)).toBe(true);
  });
});

describe('эскалация', () => {
  it('срабатывает на слове и не зовёт модель вовсе', async () => {
    const model = givenModel(SIMPLE);
    const core = coreWith(model);
    await core.registerClient({ telegramUserId: 100n });
    await core.receiveClientMessage({
      telegramUserId: 100n,
      body: 'Отправил деньги, ничего не пришло',
    });

    const result = await core.answerAsConcierge({ telegramUserId: 100n });

    expect(model.calls).toEqual([]);
    expect(bodyOf(result)).toBe(CONCIERGE_HANDOVER);
  });

  it('срабатывает на изображении: скриншот перевода — всегда про деньги', async () => {
    const model = givenModel(SIMPLE);
    const core = coreWith(model);
    await core.registerClient({ telegramUserId: 100n });
    await core.receiveClientMessage({
      telegramUserId: 100n,
      attachmentFileId: 'AgACAgIAAxkBAAI',
    });

    await core.answerAsConcierge({ telegramUserId: 100n });

    expect(model.calls).toEqual([]);
    expect(await isHandedToHuman(core, 100n)).toBe(true);
  });

  it('слышит триггер в любом сообщении череды, а не только в последнем', async () => {
    /*
     * Клиент пишет жалобу и следом «ау?». Пока фон не дошёл — выкатка,
     * упавший обработчик, — оба лежат неразобранными, и отвечается
     * последнее. Жалоба при этом не должна закрыться молча: триггер
     * слушает всю череду, а не только её хвост.
     */
    const model = givenModel(SIMPLE);
    const core = coreWith(model);
    await core.registerClient({ telegramUserId: 100n });
    await core.receiveClientMessage({
      telegramUserId: 100n,
      body: 'Отправил деньги, ничего не пришло',
    });
    await core.receiveClientMessage({ telegramUserId: 100n, body: 'Ау, вы тут?' });

    const result = await core.answerAsConcierge({ telegramUserId: 100n });

    expect(model.calls).toEqual([]);
    expect(bodyOf(result)).toBe(CONCIERGE_HANDOVER);
  });

  it('видит изображение в любом сообщении череды', async () => {
    // Скриншот перевода и подпись к нему отдельным сообщением: отвечать
    // на подпись, не видя картинки, — отвечать на «вот, оплатил», не
    // зная суммы.
    const model = givenModel(SIMPLE);
    const core = coreWith(model);
    await core.registerClient({ telegramUserId: 100n });
    await core.receiveClientMessage({
      telegramUserId: 100n,
      attachmentFileId: 'AgACAgIAAxkBAAI',
    });
    await core.receiveClientMessage({ telegramUserId: 100n, body: 'вот, оплатил' });

    await core.answerAsConcierge({ telegramUserId: 100n });

    expect(model.calls).toEqual([]);
    expect(await isHandedToHuman(core, 100n)).toBe(true);
  });

  it('срабатывает по просьбе самой модели', async () => {
    const core = coreWith(
      givenModel({ reply: 'Тут нужен менеджер.', needsHuman: true }),
    );
    await core.registerClient({ telegramUserId: 100n });
    await core.receiveClientMessage({ telegramUserId: 100n, body: 'Странный вопрос' });

    const result = await core.answerAsConcierge({ telegramUserId: 100n });

    expect(bodyOf(result)).toBe(CONCIERGE_HANDOVER);
  });

  it('доносит до сотрудников причину, а не только факт', async () => {
    const core = coreWith(givenModel(SIMPLE));
    await core.registerClient({ telegramUserId: 100n, username: 'ivan' });
    await core.receiveClientMessage({ telegramUserId: 100n, body: 'вы меня обманули' });
    await core.answerAsConcierge({ telegramUserId: 100n });

    const alerts = await core.takeStaffAlerts(new Date());

    expect(alerts).toEqual([
      expect.objectContaining({ kind: 'staff-escalation', to: 901n, clientId: 100n }),
    ]);
  });
});

describe('разговор, который ведёт человек', () => {
  it('консьержа не зовёт вовсе', async () => {
    const model = givenModel(SIMPLE);
    const core = coreWith(model);
    await core.registerClient({ telegramUserId: 100n });
    await core.receiveClientMessage({ telegramUserId: 100n, body: 'позовите менеджера' });
    await core.answerAsConcierge({ telegramUserId: 100n });

    const { notifications } = await core.receiveClientMessage({
      telegramUserId: 100n,
      body: 'Ещё вопрос',
    });
    await core.answerAsConcierge({ telegramUserId: 100n });

    expect(model.calls).toEqual([]);
    // Подтверждение приёма вернулось: первой линии больше нет, и молчать
    // в ответ на вопрос нельзя.
    expect(notifications).toEqual([
      expect.objectContaining({ kind: 'client-message-received' }),
    ]);
  });

  it('возвращается к консьержу кнопкой менеджера, а не сам', async () => {
    const model = givenModel(SIMPLE);
    const core = coreWith(model);
    await core.registerClient({ telegramUserId: 100n });
    await core.receiveClientMessage({ telegramUserId: 100n, body: 'позовите менеджера' });
    await core.answerAsConcierge({ telegramUserId: 100n });

    await core.returnToConcierge(manager, 100n);
    await core.receiveClientMessage({ telegramUserId: 100n, body: 'Какой курс?' });
    await core.answerAsConcierge({ telegramUserId: 100n });

    expect(model.calls).toHaveLength(1);
  });

  it('передаётся человеку и по кнопке менеджера, без просьбы клиента', async () => {
    // Менеджер видит разговор, который бот ведёт не туда, и забирает
    // его раньше, чем клиент об этом попросит.
    const model = givenModel(SIMPLE);
    const core = coreWith(model);
    await core.registerClient({ telegramUserId: 100n });
    await core.receiveClientMessage({ telegramUserId: 100n, body: 'Какой курс?' });
    await core.answerAsConcierge({ telegramUserId: 100n });

    await core.handOverToHuman(manager, 100n);
    await core.receiveClientMessage({ telegramUserId: 100n, body: 'Ещё вопрос' });
    await core.answerAsConcierge({ telegramUserId: 100n });

    expect(await isHandedToHuman(core, 100n)).toBe(true);
    expect(model.calls).toHaveLength(1);
  });
});

describe('пределы', () => {
  it('исчерпанный предел клиента возвращает разговор человеку', async () => {
    const core = coreWith(givenModel(SIMPLE));
    await core.updateServiceSettings(
      await givenStaff({ role: 'admin', telegramUserId: 902n }),
      { conciergeRepliesPerClientDaily: 1 },
    );
    await core.registerClient({ telegramUserId: 100n });

    await core.receiveClientMessage({ telegramUserId: 100n, body: 'Первый' });
    await core.answerAsConcierge({ telegramUserId: 100n });
    await core.receiveClientMessage({ telegramUserId: 100n, body: 'Второй' });
    const second = await core.answerAsConcierge({ telegramUserId: 100n });

    expect(bodyOf(second)).toBe(CONCIERGE_HANDOVER);
  });
});

describe('молчащий провайдер', () => {
  it('оставляет клиента с человеком, а не без ответа', async () => {
    const core = coreWith(givenModel(null));
    await core.registerClient({ telegramUserId: 100n });
    await core.receiveClientMessage({ telegramUserId: 100n, body: 'Какой курс?' });

    const result = await core.answerAsConcierge({ telegramUserId: 100n });

    expect(bodyOf(result)).toBe(CONCIERGE_HANDOVER);
    expect(await isHandedToHuman(core, 100n)).toBe(true);
  });
});

describe('страховка', () => {
  /**
   * Упавший на полпути процесс: сообщение занято, ответа нет.
   *
   * Провайдер бросает исключение так, что операция не доходит до записи
   * исхода, — ровно то, что делает перезапуск деплоя посреди ответа.
   */
  async function givenAbandonedMessage() {
    const core = coreWith({
      answer: async () => {
        throw new Error('процесс упал');
      },
    });
    await core.registerClient({ telegramUserId: 100n });
    await core.receiveClientMessage({ telegramUserId: 100n, body: 'Какой курс?' });
    await expect(core.answerAsConcierge({ telegramUserId: 100n })).rejects.toThrow();
    return core;
  }

  /** Состарить ленту клиента: столько прошло с тех пор, как он написал. */
  async function aged(minutes: number) {
    await db
      .update(clientMessages)
      .set({ createdAt: new Date(Date.now() - minutes * 60 * 1000) });
  }

  it('не трогает только что занятое: фон может ещё работать', async () => {
    // Перехватив его сразу, опрос ответил бы клиенту вторым таким же
    // сообщением — а первый ответ в это время уже в пути.
    const core = await givenAbandonedMessage();

    expect(await core.listConversationsAwaitingConcierge()).toEqual([]);
  });

  it('подбирает брошенное, когда ждать фон больше нечего', async () => {
    const core = await givenAbandonedMessage();
    await aged(10);

    expect(await core.listConversationsAwaitingConcierge()).toEqual([100n]);
  });

  it('отвечает подобранному, а не оставляет его в списке навсегда', async () => {
    await givenAbandonedMessage();
    await aged(10);
    // Провайдер ожил: тот же клиент, живая модель.
    const core = coreWith(givenModel(SIMPLE));

    const result = await core.answerAsConcierge({ telegramUserId: 100n });

    expect(bodyOf(result)).toContain(SIMPLE.reply);
    expect(await core.listConversationsAwaitingConcierge()).toEqual([]);
  });

  it('не находит того, кому уже ответили', async () => {
    const core = coreWith(givenModel(SIMPLE));
    await core.registerClient({ telegramUserId: 100n });
    await core.receiveClientMessage({ telegramUserId: 100n, body: 'Какой курс?' });
    await core.answerAsConcierge({ telegramUserId: 100n });

    expect(await core.listConversationsAwaitingConcierge()).toEqual([]);
  });
});

describe('пауза накопления', () => {
  /** Ядро с настоящей паузой: клиент должен помолчать пять секунд. */
  function quietCore(model: ConciergeSource) {
    return createCore({ db, concierge: model, conciergeQuietMs: 5000 });
  }

  it('не берёт череду, пока клиент не помолчал', async () => {
    const model = givenModel(SIMPLE);
    const core = quietCore(model);
    await core.registerClient({ telegramUserId: 100n });
    await core.receiveClientMessage({ telegramUserId: 100n, body: 'Какой курс?' });

    const result = await core.answerAsConcierge({ telegramUserId: 100n });

    expect(model.calls).toEqual([]);
    expect(result.notifications).toEqual([]);
  });

  it('после тишины отвечает одним заходом на всю пачку', async () => {
    const model = givenModel(SIMPLE);
    const core = quietCore(model);
    await core.registerClient({ telegramUserId: 100n });
    await core.receiveClientMessage({ telegramUserId: 100n, body: 'Хочу поменять USDT' });
    await core.receiveClientMessage({ telegramUserId: 100n, body: 'мне нужна карта' });
    await core.receiveClientMessage({ telegramUserId: 100n, body: 'вы тут?' });
    await agedSeconds(6);

    const result = await core.answerAsConcierge({ telegramUserId: 100n });

    expect(model.calls).toHaveLength(1);
    expect(result.notifications).toHaveLength(1);
  });

  it('страховка не видит клиента до тишины и видит после', async () => {
    const core = quietCore(givenModel(SIMPLE));
    await core.registerClient({ telegramUserId: 100n });
    await core.receiveClientMessage({ telegramUserId: 100n, body: 'Какой курс?' });

    expect(await core.listConversationsAwaitingConcierge()).toEqual([]);

    await agedSeconds(6);

    expect(await core.listConversationsAwaitingConcierge()).toEqual([100n]);
  });
});

describe('минутный предел', () => {
  async function givenFourRecentReplies(core: ReturnType<typeof coreWith>) {
    for (let i = 0; i < 4; i += 1) {
      await core.receiveClientMessage({ telegramUserId: 100n, body: 'Ещё вопрос про обмен' });
      await core.answerAsConcierge({ telegramUserId: 100n });
    }
  }

  it('пятый ответ за минуту откладывается, а не уходит', async () => {
    const model = givenModel(SIMPLE);
    const core = coreWith(model);
    await core.registerClient({ telegramUserId: 100n });
    await givenFourRecentReplies(core);

    await core.receiveClientMessage({ telegramUserId: 100n, body: 'И ещё вопрос' });
    const fifth = await core.answerAsConcierge({ telegramUserId: 100n });

    expect(model.calls).toHaveLength(4);
    expect(fifth.notifications).toEqual([]);
    // Сообщение не потеряно: оно ждёт своего окна, и страховка его видит.
    expect(await core.listConversationsAwaitingConcierge()).toEqual([100n]);
  });

  it('отвечает отложенному, когда окно прошло', async () => {
    const model = givenModel(SIMPLE);
    const core = coreWith(model);
    await core.registerClient({ telegramUserId: 100n });
    await givenFourRecentReplies(core);
    await core.receiveClientMessage({ telegramUserId: 100n, body: 'И ещё вопрос' });
    await core.answerAsConcierge({ telegramUserId: 100n });
    await agedSeconds(61);

    const result = await core.answerAsConcierge({ telegramUserId: 100n });

    expect(model.calls).toHaveLength(5);
    expect(result.notifications).toHaveLength(1);
  });

  it('жалобу уводит человеку и при выбранном пределе', async () => {
    // Эскалация токенов не тратит, и ждать окна ей нельзя: разговор про
    // непришедшие деньги не откладывают.
    const model = givenModel(SIMPLE);
    const core = coreWith(model);
    await core.registerClient({ telegramUserId: 100n });
    await givenFourRecentReplies(core);

    await core.receiveClientMessage({
      telegramUserId: 100n,
      body: 'Отправил деньги, ничего не пришло',
    });
    const result = await core.answerAsConcierge({ telegramUserId: 100n });

    expect(model.calls).toHaveLength(4);
    expect(bodyOf(result)).toBe(CONCIERGE_HANDOVER);
  });
});

describe('подсказка картинкой', () => {
  it('на знак подсказки отвечает готовой парой: картинка и подпись', async () => {
    const core = coreWith(
      givenModel({ reply: 'ПОДСКАЗКА ЗАЯВКА', needsHuman: false, hint: 'submit-request' }),
    );
    await core.registerClient({ telegramUserId: 100n });
    await core.receiveClientMessage({ telegramUserId: 100n, body: 'а как подать заявку?' });

    const result = await core.answerAsConcierge({ telegramUserId: 100n });

    const message = result.notifications.find((one) => one.kind === 'concierge-message');
    expect(message).toMatchObject({
      body: CONCIERGE_HINTS['submit-request'].caption,
      photoPath: CONCIERGE_HINTS['submit-request'].photoPath,
    });
    expect(await isHandedToHuman(core, 100n)).toBe(false);
  });
});

describe('болтовня', () => {
  it('на знак болтовни отвечает готовым текстом, а не сочиняет', async () => {
    const core = coreWith(
      givenModel({ reply: 'ОФФТОП', needsHuman: false, offTopic: true }),
    );
    await core.registerClient({ telegramUserId: 100n });
    await core.receiveClientMessage({ telegramUserId: 100n, body: 'посоветуй фильм' });

    const result = await core.answerAsConcierge({ telegramUserId: 100n });

    expect(bodyOf(result)).toBe(CONCIERGE_OFFTOPIC);
    expect(await isHandedToHuman(core, 100n)).toBe(false);
  });
});

describe('приветствие', () => {
  it('на чистое «Привет!» отвечает готовым текстом без модели', async () => {
    const model = givenModel(SIMPLE);
    const core = coreWith(model);
    await core.registerClient({ telegramUserId: 100n });
    await core.receiveClientMessage({ telegramUserId: 100n, body: 'Привет!' });

    const result = await core.answerAsConcierge({ telegramUserId: 100n });

    expect(model.calls).toEqual([]);
    expect(bodyOf(result)).toBe(CONCIERGE_HELLO);
  });

  it('приветствие с вопросом уходит модели целиком', async () => {
    const model = givenModel(SIMPLE);
    const core = coreWith(model);
    await core.registerClient({ telegramUserId: 100n });
    await core.receiveClientMessage({ telegramUserId: 100n, body: 'Привет, какой курс?' });

    await core.answerAsConcierge({ telegramUserId: 100n });

    expect(model.calls).toHaveLength(1);
  });

  it('приветствие, догнанное вопросом, уходит модели', async () => {
    const model = givenModel(SIMPLE);
    const core = coreWith(model);
    await core.registerClient({ telegramUserId: 100n });
    await core.receiveClientMessage({ telegramUserId: 100n, body: 'Привет' });
    await core.receiveClientMessage({ telegramUserId: 100n, body: 'какой курс?' });

    await core.answerAsConcierge({ telegramUserId: 100n });

    expect(model.calls).toHaveLength(1);
  });
});

describe('память', () => {
  it('включает в разговор ответы менеджера: их клиенту тоже говорили', async () => {
    const model = givenModel(SIMPLE);
    const core = coreWith(model);
    await core.registerClient({ telegramUserId: 100n });
    await core.receiveClientMessage({ telegramUserId: 100n, body: 'Первый вопрос' });
    await core.replyToClient(manager, { clientId: 100n, body: 'Ответ менеджера' });
    await core.receiveClientMessage({ telegramUserId: 100n, body: 'Второй вопрос' });

    await core.answerAsConcierge({ telegramUserId: 100n });

    const request = model.calls[0]?.request as { conversation: { text: string }[] };
    expect(request.conversation.map((one) => one.text)).toContain('Ответ менеджера');
  });
});

/** Текст, ушедший клиенту. */
function bodyOf(result: { notifications: readonly { kind: string }[] }): string {
  const message = result.notifications.find((one) => one.kind === 'concierge-message');
  return (message as { body?: string } | undefined)?.body ?? '';
}

async function isHandedToHuman(
  core: ReturnType<typeof coreWith>,
  clientId: bigint,
): Promise<boolean> {
  const conversations = await core.listConversations(manager);
  return conversations.find((one) => one.clientId === clientId)?.handedToHuman ?? false;
}
