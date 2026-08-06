import { botToken, deliverNotifications } from '@nemo/telegram';
import { errorResponse, json, requireInitData } from '@/lib/api';
import { getCore } from '@/lib/core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Просьба оплатить что-то за границей: бронь отеля, покупку в зарубежном
 * магазине.
 *
 * Отдельной сущности у этого нет и пока не должно быть. Что это за
 * продукт, ещё не решено: по какому курсу считается чужой счёт и кто
 * несёт риск изменения цены между просьбой и оплатой — вопросы про
 * деньги, а не про экран, и отвечать на них до первых живых просьб
 * значит отвечать наугад.
 *
 * Поэтому просьба уходит обращением — в ту же переписку, где клиент
 * говорит с менеджером обо всём остальном. Менеджер называет цену в
 * чате, как он делает это с наличными, у которых курса тоже нет. Когда
 * таких просьб станет много и станет ясно, что в них повторяется, из
 * них вырастет заявка со своими состояниями.
 *
 * Приложение при этом собирает текст само: клиент, пишущий менеджеру
 * «оплатите отель», забывает назвать сумму, город и срок — и разговор
 * начинается с трёх уточняющих вопросов.
 */

/** О чём просьба. Список короткий и лежит здесь: он и есть весь продукт. */
const TOPICS: Readonly<Record<string, string>> = {
  hotel: 'Оплата отеля',
  purchase: 'Оплата онлайн-покупки',
};

/**
 * Сколько текста принимаем. Тысяча знаков — это ссылка на бронь, город,
 * даты и сумма с запасом; больше в одно сообщение Telegram всё равно не
 * поместится осмысленно.
 */
const MAX_DETAILS = 1000;

export async function POST(request: Request): Promise<Response> {
  try {
    const initData = requireInitData(request);
    const body: unknown = await request.json().catch(() => ({}));
    const input = body as { topic?: unknown; details?: unknown };

    const subject = typeof input.topic === 'string' ? TOPICS[input.topic] : undefined;
    if (!subject) {
      return json({ error: 'Неизвестная просьба' }, { status: 400 });
    }

    const details = typeof input.details === 'string' ? input.details.trim() : '';
    if (!details) {
      return json({ error: 'Опишите, что нужно оплатить' }, { status: 400 });
    }
    if (details.length > MAX_DETAILS) {
      return json({ error: 'Слишком длинное описание' }, { status: 400 });
    }

    // Обращение уходит от лица клиента и подписано темой: менеджер
    // читает ленту переписки подряд, и «Оплата отеля» в первой строке
    // отвечает на вопрос, о чём речь, до самого текста.
    const { notifications } = await getCore().receiveClientMessage({
      telegramUserId: initData.telegramUserId,
      body: `${subject}. ${details}`,
      ...(initData.username ? { username: initData.username } : {}),
    });
    await deliverNotifications(notifications, { botToken: botToken() });

    return json({ ok: true }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
