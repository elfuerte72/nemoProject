import type { CoreConfig } from './context.js';
import { receiveClientMessage, type ReceiveMessageResult } from './conversations.js';
import { InvalidInputError } from './errors.js';

/**
 * Просьба оплатить что-то за границей: бронь отеля, покупку в зарубежном
 * магазине.
 *
 * Своей сущности у неё нет и пока не должно быть. Чем именно станет
 * оплата чужого счёта — по какому курсу считается и кто несёт риск
 * изменения цены между просьбой и оплатой — вопросы про деньги, а не про
 * экран, и отвечать на них до первых живых просьб значит отвечать
 * наугад. Поэтому просьба уходит обращением в ту же переписку, где
 * клиент говорит с менеджером обо всём остальном, а цену называет
 * менеджер — как он делает это с наличными, у которых курса тоже нет.
 *
 * Операция, а не разбор в маршруте: состав тем, потолок длины и то, как
 * из них собирается текст, — правила предметной области. В маршруте они
 * держались бы ровно до второго способа подать просьбу.
 *
 * Когда таких просьб станет много и станет видно, что в них
 * повторяется, отсюда вырастет заявка со своими состояниями.
 */

/** О чём просьба. Список короткий и лежит здесь: он и есть весь продукт. */
export const inquiryTopics = ['hotel', 'purchase'] as const;
export type InquiryTopic = (typeof inquiryTopics)[number];

/**
 * Чем просьба подписана в переписке. Менеджер читает ленту подряд, и
 * «Оплата отеля» в первой строке отвечает, о чём речь, до самого текста.
 */
const SUBJECTS: Readonly<Record<InquiryTopic, string>> = {
  hotel: 'Оплата отеля',
  purchase: 'Оплата онлайн-покупки',
};

/**
 * Сколько текста принимаем. Тысяча знаков — это ссылка на бронь, город,
 * даты и сумма с запасом; больше в одно сообщение осмысленно не
 * помещается.
 */
const MAX_DETAILS = 1000;

export interface SubmitInquiryInput {
  readonly telegramUserId: bigint;
  readonly topic: string;
  readonly details: string;
  readonly username?: string | undefined;
}

export function isInquiryTopic(value: string): value is InquiryTopic {
  return (inquiryTopics as readonly string[]).includes(value);
}

export async function submitInquiry(
  ctx: CoreConfig,
  input: SubmitInquiryInput,
): Promise<ReceiveMessageResult> {
  if (!isInquiryTopic(input.topic)) {
    throw new InvalidInputError('Неизвестная просьба');
  }

  const details = input.details.trim();
  if (!details) {
    throw new InvalidInputError('Опишите, что нужно оплатить');
  }
  if (details.length > MAX_DETAILS) {
    throw new InvalidInputError(`Описание длиннее ${MAX_DETAILS} знаков`);
  }

  return receiveClientMessage(ctx, {
    telegramUserId: input.telegramUserId,
    body: `${SUBJECTS[input.topic]}. ${details}`,
    ...(input.username ? { username: input.username } : {}),
  });
}
