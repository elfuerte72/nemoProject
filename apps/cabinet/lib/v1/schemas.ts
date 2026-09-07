import { z } from 'zod';
import { InvalidInputError } from '@nemo/core';
import { exchangeRequestStatusSchema, Money, requisiteInputSchema } from '@nemo/types';

/**
 * Тела и параметры запросов к API v1 — и слова, которыми они
 * отвергаются.
 *
 * Разбор здесь проверяет форму: что поле есть, что сумма — число
 * строкой, что состояние из списка. Правила предметной области —
 * минимум, направление, правдоподобие реквизита — остаются в ядре и
 * отвечают своими словами: путь через API не должен быть ни слабее
 * пути через форму, ни другим.
 *
 * Деньги строками (`Money` из `@nemo/types`): через число дробная
 * часть криптовалюты потерялась бы ещё до проверки.
 */

const currencyCode = z
  .string()
  .trim()
  .min(2)
  .max(12)
  .transform((value) => value.toUpperCase());

const amount = z
  .string()
  .trim()
  .refine((value) => Money.positiveAmountSchema.safeParse(value).success, {
    message: 'сумма — положительное число строкой, «100» или «49.5»',
  });

/** С какой стороны названа сумма: сколько отдаю или сколько должно прийти. */
export const sideSchema = z.enum(['from', 'to']).default('from');
export type QuoteSide = z.infer<typeof sideSchema>;

/*
 * Тела — строгие: неизвестное поле отвергается, а не выбрасывается
 * молча. Так ловится опечатка в имени поля, а «kind: cash» получает
 * ответ словами, а не электронную заявку вместо наличной.
 */
export const quoteBodySchema = z
  .object({
    from: currencyCode,
    to: currencyCode,
    amount,
    side: sideSchema,
    /**
     * Куда уйдут деньги — банк или кошелёк: у бата и юаня ставка от
     * этого зависит. Не задано — банк, как на экране до выбора записи.
     */
    payoutMethod: z.enum(['bank', 'wallet']).optional(),
  })
  .strict();
export type QuoteBody = z.infer<typeof quoteBodySchema>;

export const exchangeRequestBodySchema = quoteBodySchema
  .omit({ payoutMethod: true })
  .extend({
    /** Свой номер сделки: «booking-1024». Виден менеджеру и мерчанту. */
    reference: z.string().trim().max(200).optional(),
    /** Отметка курса из ответа `/quote`: заявка уйдёт по нему. */
    quotedAt: z.coerce.date().optional(),
    requisitesId: z.string().uuid().optional(),
    payout: requisiteInputSchema.optional(),
  })
  .strict();
export type ExchangeRequestBody = z.infer<typeof exchangeRequestBodySchema>;

export const requisitesBodySchema = requisiteInputSchema;

/** Сколько заявок отдаётся за раз, когда предел не назван, и потолок. */
export const LIST_LIMIT = 50;
export const LIST_MAX = 200;

const listQuerySchema = z.object({
  status: exchangeRequestStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(LIST_MAX).default(LIST_LIMIT),
  after: z.coerce.date().optional(),
  afterId: z.string().uuid().optional(),
});

export interface ListQuery {
  readonly status?: z.infer<typeof exchangeRequestStatusSchema> | undefined;
  readonly limit: number;
  readonly after?: { readonly createdAt: Date; readonly id: string } | undefined;
}

export function parseBody<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, raw: string): T {
  let parsed: unknown;
  try {
    parsed = raw.trim() === '' ? {} : JSON.parse(raw);
  } catch {
    throw new InvalidInputError('Тело запроса — JSON');
  }
  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new InvalidInputError(complaintOf(result.error));
  }
  return result.data;
}

export function parseListQuery(params: URLSearchParams): ListQuery {
  const result = listQuerySchema.safeParse({
    status: params.get('status') ?? undefined,
    limit: params.get('limit') ?? undefined,
    after: params.get('after') ?? undefined,
    afterId: params.get('afterId') ?? undefined,
  });
  if (!result.success) {
    throw new InvalidInputError(complaintOf(result.error));
  }
  const { status, limit, after, afterId } = result.data;
  if ((after === undefined) !== (afterId === undefined)) {
    throw new InvalidInputError('Курсор — пара after и afterId из прошлого ответа, оба сразу');
  }
  return {
    status,
    limit,
    after: after && afterId ? { createdAt: after, id: afterId } : undefined,
  };
}

/** Длина ключа повтора — та же, что у ядра для внешнего номера. */
const MAX_IDEMPOTENCY_KEY = 200;

/**
 * Ключ повтора обязателен: сеть рвётся посреди ответа, и мерчант, не
 * получивший его, повторяет запрос — без ключа он оплатил бы обмен
 * дважды. Заголовок, а не поле тела: так его не забыть при копировании
 * примера, и так он устроен у остальных.
 */
export function requireIdempotencyKey(request: Request): string {
  const key = request.headers.get('idempotency-key')?.trim();
  if (!key) {
    throw new InvalidInputError(
      'Нужен заголовок Idempotency-Key — свой уникальный ключ запроса, например номер брони: ' +
        'повтор с тем же ключом вернёт ту же заявку',
    );
  }
  if (key.length > MAX_IDEMPOTENCY_KEY) {
    throw new InvalidInputError(`Idempotency-Key: не длиннее ${MAX_IDEMPOTENCY_KEY} знаков`);
  }
  return key;
}

/** Первая беда словами: поле и что с ним не так. Остальные мерчант увидит следующим вызовом. */
function complaintOf(error: z.ZodError): string {
  const [issue] = error.issues;
  if (!issue) return 'Запрос не разобран';
  if (issue.code === 'unrecognized_keys') {
    return `Неизвестные поля: ${issue.keys.join(', ')} — таких у запроса нет, см. документацию`;
  }
  const path = issue.path.join('.');
  const what =
    issue.code === 'invalid_type' && issue.received === 'undefined'
      ? 'обязательно'
      : issue.message;
  return path ? `Поле «${path}»: ${what}` : what;
}
