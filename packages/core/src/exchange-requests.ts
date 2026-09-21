import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  lt,
  lte,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import {
  clientRequisites,
  currencies,
  currencyPairs,
  exchangeRequestEvents,
  exchangeRequests,
} from '@nemo/db';
import {
  Money,
  payoutMethodOf,
  type Amount,
  type CurrencyKind,
  type ExchangeKind,
  type ExchangeRequestSource,
  type ExchangeRequestStatus,
  type PayoutMethod,
  isUuid,
  minimumMeasure,
} from '@nemo/types';
import { requireOwner, requireOwnerAbility, type Actor, type Owner } from './actor.js';
import { requirePositiveAmount } from './amounts.js';
import { CLIENT_HISTORY_LIMIT } from './client-history.js';
import type { CoreConfig, Executor } from './context.js';
import { ConflictError, InvalidInputError, NotFoundError } from './errors.js';
import { publishLiveEvent } from './live-events.js';
import { cyrillicLike, likePattern } from './search.js';
import { enqueueWebhookDeliveries } from './webhooks.js';
import type { Notification } from './notifications.js';
import { quoteForSubmission } from './rates.js';
import { requireActiveMerchant, recipientOf } from './merchants.js';
import {
  ownerColumns,
  payoutMethodOfInput,
  requireSuitableRequisites,
  requisitesOf,
  type RequisitesView,
  saveRequisitesIn,
  type SaveRequisitesInput,
  toView,
} from './requisites.js';
import { MIN_EXCHANGE_CODE, readServiceSettings } from './settings.js';

/**
 * Заявка на обмен: что клиент отдаёт, что хочет получить и на какую
 * сумму.
 *
 * Курс безналичной заявки называется при подаче и дальше не меняется:
 * по какому курсу клиент нажал — по такому сервис и работает
 * (docs/adr/0006). Обязательство ограничено сроком: не оплатил вовремя
 * — заявка отменяется.
 *
 * У наличной заявки курс появляется вместе со своей ставкой: наличный
 * обмен стоит сервису другого, чем перевод, и сетку для него
 * администратор заводит отдельно. Пока её нет, заявка уходит без курса
 * и цену называет менеджер — так же ведёт себя безналичная заявка,
 * поданная при молчащем источнике котировок: отказывать в подаче из-за
 * молчания провайдера нельзя, для клиента это выглядит поломкой.
 */

/**
 * Заявка на обмен глазами клиента. Дохода сервиса здесь нет и быть не может:
 * это внутренняя величина, из которой считаются реферальные начисления.
 */
export interface ExchangeRequestView {
  readonly id: string;
  /**
   * Чья заявка: клиента или мерчанта (docs/adr/0017). Размеченным
   * объединением, а не парой необязательных полей: «оба пусты» — это
   * заявка без владельца, и разрешать такое чтение значило бы
   * разрешить его и записи.
   */
  readonly owner: Owner;
  readonly kind: ExchangeKind;
  readonly fromCode: string;
  readonly toCode: string;
  readonly fromAmount: Amount;
  readonly toAmount: Amount | null;
  /**
   * Курс, по которому подана заявка. У безналичной — обязательство
   * сервиса; пусто у наличной и у поданной при молчащем источнике.
   */
  readonly requestRate: Amount | null;
  readonly finalRate: Amount | null;
  readonly status: ExchangeRequestStatus;
  /**
   * Когда менеджер выдал реквизиты. От этого момента идёт срок оплаты:
   * сколько его осталось, экран считает по сроку из условий обмена.
   */
  readonly requisitesIssuedAt: Date | null;
  /**
   * Куда ушли деньги по этой заявке. Клиенту он нужен, чтобы следующая
   * заявка в ту же валюту открывалась на той же записи, а не заставляла
   * выбирать заново.
   */
  readonly requisitesId: string | null;
  /**
   * Куда клиенту платить. Названы менеджером и показываются в самой
   * заявке, а не только в сообщении бота: клиент возвращается к ней
   * через день и не должен искать сообщение в переписке.
   */
  readonly paymentInstructions: string | null;
  readonly cancelReason: string | null;
  /**
   * Внешний номер мерчанта: «бронь №1024». Пусто у заявки клиента — ей
   * взяться ему неоткуда.
   */
  readonly reference: string | null;
  /**
   * Кто подал внутри мерчанта. Пусто у заявки клиента, у поданной
   * ключом API — ключ ничей — и у поданных до появления отметки.
   */
  readonly submittedByUserId: string | null;
  /**
   * Откуда заявка пришла — со слов того, кто принял запрос: операция
   * подачи у Mini App и API одна, и различить их изнутри нечем. Пусто у
   * поданных до появления отметки, и пустота так и отдаётся: угаданный
   * источник читался бы как записанный.
   */
  readonly source: ExchangeRequestSource | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly completedAt: Date | null;
}

export interface SubmitExchangeRequestInput {
  readonly kind: ExchangeKind;
  readonly fromCode: string;
  readonly toCode: string;
  readonly fromAmount: string;
  /** Куда отправлять деньги. Реквизиты клиент подтверждает при подаче. */
  readonly requisitesId?: string | undefined;
  /**
   * Получатель прямо в запросе — так подаёт мерчант по API: у его
   * покупателя сохранённых записей нет и не будет, а заводить их
   * отдельным вызовом значит требовать двух запросов там, где хватает
   * одного. Запись заводится и сразу архивируется: список получателей
   * не должен расти на каждую заявку.
   *
   * Вместе с `requisitesId` не приходит: два получателя у одной заявки
   * означали бы, что деньги ушли неизвестно куда из двух.
   */
  readonly payout?: SaveRequisitesInput | undefined;
  /**
   * Отметка времени курса, который клиент видел на экране. По нему
   * заявка и уходит (docs/adr/0006) — спрошенный заново курс успевал бы
   * обновиться между показом и нажатием.
   */
  readonly quotedAt?: Date | undefined;
  /** Внешний номер мерчанта: «бронь №1024». Только у него. */
  readonly reference?: string | undefined;
  /**
   * Ключ повтора. Тот же ключ возвращает ту же заявку, а не заводит
   * вторую: сеть рвётся посреди ответа, и мерчант, не получивший его,
   * повторяет запрос — без ключа он оплатил бы обмен дважды.
   */
  readonly idempotencyKey?: string | undefined;
  /**
   * Откуда пришёл запрос: Mini App, форма кабинета или API мерчанта.
   *
   * Называет его тот, кто принял запрос: операция у всех троих одна, и
   * различить их изнутри нечем. Ядро отметку не толкует — ни правил, ни
   * цены от неё не зависит; она нужна разрезу мерчанта «сколько прошло
   * через интеграцию, а сколько завели руками». Не назван — пусто:
   * угаданный источник читался бы как записанный.
   */
  readonly source?: ExchangeRequestSource | undefined;
}

export interface SubmitExchangeRequestResult {
  readonly request: ExchangeRequestView;
  readonly notifications: readonly Notification[];
}

export interface CurrencyPairView {
  readonly fromCode: string;
  readonly toCode: string;
  readonly kind: ExchangeKind;
}

/**
 * Валюта направления с её родом. Род нужен экрану, а не только ядру: от
 * него зависит, какой реквизит подходит заявке, и вычислять его по коду
 * валюты приложение не должно — «USDT это криптовалюта» знает
 * справочник.
 */
export interface TermsCurrencyView {
  readonly code: string;
  readonly kind: CurrencyKind;
}

/**
 * Условия обмена для экрана заявки: куда сервис меняет и от какой суммы
 * берётся. Минимум приходит вместе с направлениями, а не отдельным
 * запросом: клиент должен узнать его до подачи, а не из отказа.
 */
export interface ExchangeTermsView {
  readonly pairs: readonly CurrencyPairView[];
  readonly currencies: readonly TermsCurrencyView[];
  readonly minAmount: Amount;
  /** Валюта минимума: см. `MIN_EXCHANGE_CODE`. */
  readonly minAmountCode: string;
  /**
   * Сколько заявка ждёт оплаты после выдачи реквизитов, в минутах.
   * Экран считает по нему, сколько времени у клиента осталось.
   */
  readonly unpaidTtlMinutes: number;
}

type ExchangeRequestRow = typeof exchangeRequests.$inferSelect;

/**
 * Денежные величины нормализуются: база хранит `numeric(38, 18)` и
 * отдаёт `100.000000000000000000` там, где клиент вводил `100`. Хвост
 * нулей не несёт смысла, а в интерфейсе выглядит ошибкой.
 */
function toDisplayAmount(value: string | null): Amount | null {
  return value === null ? null : Money.toAmount(value);
}

/**
 * Владелец строки. Ограничение базы держит «ровно одного», и пустота с
 * обеих сторон означала бы, что оно снято, — молча подставлять сюда
 * что-то ради типов нельзя.
 */
export function ownerOf(row: {
  clientId: bigint | null;
  merchantId: string | null;
}): Owner {
  if (row.clientId !== null) return { kind: 'client', clientId: row.clientId };
  if (row.merchantId !== null) return { kind: 'merchant', merchantId: row.merchantId };
  throw new Error('Строка без владельца: снято ограничение базы');
}

export function toExchangeRequestView(row: ExchangeRequestRow): ExchangeRequestView {
  return {
    id: row.id,
    owner: ownerOf(row),
    kind: row.kind,
    fromCode: row.fromCode,
    toCode: row.toCode,
    fromAmount: Money.toAmount(row.fromAmount),
    toAmount: toDisplayAmount(row.toAmount),
    requestRate: toDisplayAmount(row.requestRate),
    finalRate: toDisplayAmount(row.finalRate),
    status: row.status,
    requisitesIssuedAt: row.requisitesIssuedAt,
    requisitesId: row.requisitesId,
    paymentInstructions: row.paymentInstructions,
    cancelReason: row.cancelReason,
    reference: row.reference,
    submittedByUserId: row.submittedByUserId,
    source: row.source,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    completedAt: row.completedAt,
  };
}

/**
 * Направление обмена: пара валют плюс способ исполнения. Наличные и
 * электронный перевод — разные направления, а не одно с признаком:
 * безналичный курс сервис берёт у биржи, наличный называет менеджер, и
 * включить или выключить их нужно порознь.
 */
async function requireActivePair(
  executor: Executor,
  input: { fromCode: string; toCode: string; kind: ExchangeKind },
): Promise<void> {
  const [pair] = await executor
    .select({ id: currencyPairs.id })
    .from(currencyPairs)
    .where(
      and(
        eq(currencyPairs.fromCode, input.fromCode),
        eq(currencyPairs.toCode, input.toCode),
        eq(currencyPairs.kind, input.kind),
        eq(currencyPairs.isActive, true),
      ),
    )
    .limit(1);

  if (!pair) {
    throw new NotFoundError(
      `Направление ${input.fromCode} → ${input.toCode} (${input.kind}) недоступно`,
    );
  }

  // Валюта могла быть отключена отдельно от направления: закрывая
  // валюту целиком, администратор не обязан помнить про каждую пару.
  const active = await executor
    .select({ code: currencies.code })
    .from(currencies)
    .where(
      and(
        inArray(currencies.code, [input.fromCode, input.toCode]),
        eq(currencies.isActive, true),
      ),
    );

  if (active.length < 2) {
    throw new NotFoundError(
      `Направление ${input.fromCode} → ${input.toCode} недоступно: валюта отключена`,
    );
  }
}

/**
 * Каким способом уйдут деньги по этой записи — от него зависит ставка
 * комиссии.
 *
 * Читается до транзакции вместе с котировкой: сетку выбирают по нему, а
 * котировка это обращение к чужому API, и держать ради него открытую
 * транзакцию нельзя. Пригодность записи проверяется всё равно внутри —
 * здесь важно только, банк это или кошелёк. Решает запись целиком, а не
 * род: у PromptPay ответ зависит от того, что внутри QR.
 *
 * Чужая или удалённая запись отвечает пустотой, а не отказом: отказать
 * должна проверка внутри транзакции, и своё сообщение у неё уже есть.
 */
async function readPayoutMethod(
  executor: Executor,
  owner: Owner,
  requisitesId: string,
): Promise<PayoutMethod | undefined> {
  const [row] = await executor
    .select({ kind: clientRequisites.kind, promptpayIdType: clientRequisites.promptpayIdType })
    .from(clientRequisites)
    .where(and(eq(clientRequisites.id, requisitesId), requisitesOf(owner)))
    .limit(1);
  return row === undefined ? undefined : payoutMethodOf(row);
}

export async function submitExchangeRequest(
  ctx: CoreConfig,
  actor: Actor,
  input: SubmitExchangeRequestInput,
): Promise<SubmitExchangeRequestResult> {
  const { owner, submittedByUserId } = requireOwnerAbility(actor, 'submit');
  const fromAmount = requirePositiveAmount(input.fromAmount, 'Сумма заявки');

  if (input.requisitesId !== undefined && input.payout !== undefined) {
    throw new InvalidInputError(
      'Укажите либо сохранённые реквизиты, либо реквизиты получателя, но не оба',
    );
  }

  /*
   * Что нельзя мерчанту и что нельзя клиенту.
   *
   * Наличные по API не подаются: встреча и касса программно не
   * автоматизируются, и заявка, которую некому исполнить, хуже отказа.
   * Внешний номер и ключ повтора, наоборот, свойства мерчанта — у
   * клиента им взяться неоткуда, и приняв их молча, сервис завёл бы
   * заявку, которую отвергнет ограничение базы.
   */
  if (owner.kind === 'merchant' && input.kind === 'cash') {
    throw new InvalidInputError(
      'Наличный обмен подаётся не по API: о встрече договариваются с менеджером',
    );
  }
  if (owner.kind === 'client' && (input.reference !== undefined || input.idempotencyKey !== undefined)) {
    throw new InvalidInputError('Внешний номер и ключ повтора бывают только у мерчанта');
  }

  /*
   * Пустое поле — это отсутствие поля, а не значение «пусто». Обвязка
   * мерчанта, шлющая ключ повтора пустым, иначе получала бы на каждую
   * новую заявку первую: заявки перестают подаваться, и молча.
   */
  const reference = trimmedOrNone(input.reference, 'Внешний номер');
  const idempotencyKey = trimmedOrNone(input.idempotencyKey, 'Ключ повтора');

  const requisitesGiven = input.requisitesId !== undefined || input.payout !== undefined;
  // Электронный перевод без реквизитов исполнить невозможно: деньги
  // некуда отправить. Правило живёт здесь, а не в форме, потому что
  // форма — не единственный способ вызвать операцию, а последствие у
  // пропуска одно на всех: заявка, застрявшая у менеджера.
  if (input.kind === 'electronic' && !requisitesGiven) {
    throw new InvalidInputError(
      'Для электронного перевода нужны реквизиты: укажите, куда отправить деньги',
    );
  }
  // Наличные клиент получает на руки. Приложенный к такой заявке
  // реквизит означал бы, что менеджер отправит перевод туда, куда клиент
  // денег не ждёт: два способа получения у одной заявки не бывает.
  if (input.kind === 'cash' && requisitesGiven) {
    throw new InvalidInputError(
      'Наличные выдаются на руки: реквизиты для перевода к такой заявке не прикладываются',
    );
  }

  /*
   * Повтор с тем же ключом отдаёт ту же заявку, а не заводит вторую.
   * Читается до всего остального: у повторённого запроса ни котировка,
   * ни запись получателя новыми быть не должны — иначе повтор стоил бы
   * ещё одной архивной записи и похода к бирже.
   */
  if (idempotencyKey !== undefined) {
    const repeated = await findByIdempotencyKey(ctx.db, owner, idempotencyKey);
    if (repeated) {
      return { request: repeated, notifications: [] };
    }
  }

  // Котировка запрашивается до транзакции: это обращение к чужому API,
  // и держать открытой транзакцию на время сетевого запроса значило бы
  // отдавать соединение с базой в распоряжение чужого сервиса.
  /*
   * Способ выдачи говорит запись, на которую придут деньги, а не
   * клиент: ставка у перевода в банк и в кошелёк разная, и позволить
   * назвать её самому значило бы позволить выбрать цену. Читается до
   * транзакции — вместе с котировкой, потому что от него зависит, по
   * какой сетке считать.
   */
  const payoutMethod =
    input.requisitesId !== undefined
      ? await readPayoutMethod(ctx.db, owner, input.requisitesId)
      : input.payout === undefined
        ? undefined
        : payoutMethodOfInput(input.payout);

  /*
   * У наличной сделки способ выдачи один — из рук в руки, — и ставка у
   * него своя: наличный обмен стоит сервису другого, чем перевод. Пока
   * администратор её не завёл, котировки нет и заявка уходит без курса,
   * как было до ступеней, — цену называет менеджер.
   */
  const quote = await quoteForSubmission(ctx, {
    fromCode: input.fromCode,
    toCode: input.toCode,
    fromAmount,
    ...(input.kind === 'cash'
      ? { payoutMethod: 'cash' as const }
      : payoutMethod === undefined
        ? {}
        : { payoutMethod }),
    asOf: input.quotedAt,
  });
  const requestRate = quote?.rate ?? null;

  return ctx.db.transaction(async (tx) => {
    if (owner.kind === 'merchant') {
      // Отключённый мерчант заявок не подаёт: ключ перестаёт работать в
      // ту же секунду, а открытые заявки доходят до конца.
      await requireActiveMerchant(tx, owner.merchantId);
    }
    await requireActivePair(tx, input);

    /*
     * Получатель из тела запроса заводится здесь же, в транзакции
     * заявки: порознь каждая отвергнутая подача оставляла бы в базе
     * зашифрованную запись, на которую никто не сошлётся. Архивной
     * сразу — список получателей мерчанта не должен расти на каждую
     * заявку.
     */
    const requisitesId =
      input.payout === undefined
        ? input.requisitesId
        : (await saveRequisitesIn(ctx, tx, owner, input.payout, { archived: true })).id;

    if (requisitesId !== undefined) {
      await requireSuitableRequisites(tx, owner, requisitesId, input.toCode, {
        allowArchived: input.payout !== undefined,
      });
    }

    const settings = await readServiceSettings(tx);
    /*
     * Порог задан в USDT. Чем его мерить — долларовым эквивалентом, уже
     * посчитанным ради выбора ступени, или стороной в валюте порога, —
     * решает `minimumMeasure` из `@nemo/types`: тем же правилом экран не
     * даёт подать заявку, которую подача отвергнет. Курса может не быть
     * вовсе — у наличных до разговора с менеджером, при молчащем
     * провайдере, — и тогда полученной стороны нет, а порог не
     * проверяется: отказ по числу, которого у сервиса в этот момент не
     * существует, выглядел бы поломкой.
     */
    const measured = minimumMeasure({
      thresholdCode: MIN_EXCHANGE_CODE,
      fromCode: input.fromCode,
      toCode: input.toCode,
      give: fromAmount,
      get: requestRate === null ? null : Money.multiply(fromAmount, requestRate),
      usdAmount: quote?.usdAmount ?? null,
    });
    if (measured !== null && Money.compare(measured, settings.minExchangeAmount) < 0) {
      throw new InvalidInputError(
        `Минимальная сумма обмена — ${settings.minExchangeAmount} ${MIN_EXCHANGE_CODE}`,
      );
    }

    /*
     * Свой минимум направления — поверх общего: владелец задаёт евро
     * «меньше пятисот долларов — недоступно». Порог приходит вместе с
     * котировкой и меряется тем же долларовым эквивалентом, что и
     * глобальный; без котировки его не посчитать, и заявка уходит без
     * курса — отказ по числу, которого у сервиса в этот момент нет,
     * выглядел бы поломкой.
     */
    const directionMin = quote?.fee?.minUsd ?? null;
    if (
      directionMin !== null &&
      measured !== null &&
      Money.compare(measured, directionMin) < 0
    ) {
      throw new InvalidInputError(
        `Минимальная сумма для этого направления — ${directionMin} $`,
      );
    }

    /*
     * Выдача, съеденная комиссией целиком, — не сделка: арифметика
     * клампит отрицательное в ноль, и без этого правила заявка ушла бы
     * обязательством «0 по курсу 0». В норме такие суммы отсекают
     * пороги выше, но порог — настройка, а не гарантия.
     */
    if (quote?.toAmount != null && Money.isZero(quote.toAmount)) {
      throw new InvalidInputError(
        'Сумма слишком мала: после комиссии к выдаче ничего не остаётся',
      );
    }

    const [row] = await insertRequest(tx, {
      ...ownerColumns(owner),
      // Кто подал внутри мерчанта: у клиента и у ключа API автора нет.
      ...(submittedByUserId === null ? {} : { submittedByUserId }),
      ...(reference === undefined ? {} : { reference }),
      ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
      ...(input.source === undefined ? {} : { source: input.source }),
      kind: input.kind,
      fromCode: input.fromCode,
      toCode: input.toCode,
      fromAmount,
      requestRate,
      /*
       * Сумма к получению — такое же обещание, как и курс: клиент видел
       * её в калькуляторе и по ней принимал решение. Считается здесь, а
       * не набирается менеджером руками, иначе обещание держалось бы на
       * его внимательности.
       *
       * Берётся из котировки, а не пересчитывается умножением: со
       * ступенчатой комиссией курс — это уже частное от посчитанной
       * выдачи, и обратное умножение разошлось бы с ней на хвост
       * округления. Клиент видел именно это число.
       */
      toAmount: quote?.toAmount ?? null,
      /*
       * Удержанное сервисом — только у цены по сетке и только на момент
       * подачи: ставка ступени взята от долларового эквивалента, а курс
       * доллара живёт минуту. Менеджер вписывает доход при исполнении
       * через день, и восстановить это число тогда уже нечем.
       */
      serviceFeePayout: quote?.feePayout ?? null,
      requisitesId: requisitesId ?? null,
    });

    /*
     * Повтор, обогнавший первый запрос, отдаёт ту же заявку: ключ и
     * заведён ради этого случая, а пятисотый ответ заставил бы мерчанта
     * повторить ещё раз.
     */
    if (row === undefined) {
      const repeated = await findByIdempotencyKey(tx, owner, idempotencyKey!);
      if (repeated === undefined) {
        throw new ConflictError('Заявка уже подаётся: повторите запрос');
      }
      return { request: repeated, notifications: [] };
    }

    // История заявки начинается с того, как она появилась: иначе в
    // разборе спорного обмена первый её шаг ничем не подтверждён.
    await tx.insert(exchangeRequestEvents).values({
      requestId: row!.id,
      fromStatus: null,
      toStatus: 'new',
      actorType: owner.kind,
    });

    // Заявка появилась в очереди: тот, кто ждёт работу у экрана, узнаёт
    // об этом сразу, а не с очередным тиком таймера.
    await publishLiveEvent(tx, { topic: 'exchange' });
    // И мерчанту — вебхуком, в той же транзакции (docs/adr/0018).
    await enqueueWebhookDeliveries(tx, { id: row!.id, merchantId: row!.merchantId, status: 'new' });

    const request = toExchangeRequestView(row!);
    return {
      request,
      notifications: [
        {
          kind: 'exchange-request-status',
          to: await recipientOf(tx, owner, submittedByUserId),
          requestId: request.id,
          status: 'new',
        },
      ],
    };
  });
}

/**
 * Заявка, поданная с этим ключом раньше. Пусто — такой ещё не было.
 *
 * Ищется по паре «владелец и ключ»: «booking-1024» у двух мерчантов —
 * два разных обмена, и общий поиск отдал бы второму чужую заявку.
 */
async function findByIdempotencyKey(
  executor: Executor,
  owner: Owner,
  idempotencyKey: string,
): Promise<ExchangeRequestView | undefined> {
  const [row] = await executor
    .select()
    .from(exchangeRequests)
    .where(and(ownedBy(owner), eq(exchangeRequests.idempotencyKey, idempotencyKey)))
    .limit(1);
  return row === undefined ? undefined : toExchangeRequestView(row);
}

/**
 * Вставка заявки, уступающая повтору.
 *
 * `on conflict do nothing` вместо перехвата ошибки: нарушение
 * уникальности, брошенное внутри транзакции, прерывает её целиком —
 * дочитать по ключу было бы уже нечем. Пустой ответ здесь означает, что
 * заявку с этим ключом успел записать кто-то другой; ждать его Postgres
 * будет сам, а после его коммита строка уже видна.
 *
 * Цель конфликта названа поимённо: без неё любой уникальный индекс,
 * заведённый над заявками позже, молча читался бы как повтор.
 */
async function insertRequest(
  tx: Executor,
  values: typeof exchangeRequests.$inferInsert,
): Promise<(typeof exchangeRequests.$inferSelect)[]> {
  return tx
    .insert(exchangeRequests)
    .values(values)
    .onConflictDoNothing({
      target: [exchangeRequests.merchantId, exchangeRequests.idempotencyKey],
      where: sql`${exchangeRequests.idempotencyKey} is not null`,
    })
    .returning();
}

/**
 * Поле, которого может не быть: пустая строка — это его отсутствие, а
 * не значение «пусто». Записанная в базу, она означала бы, что все
 * заявки мерчанта поданы «под одним ключом», и вторая возвращала бы
 * первую.
 *
 * Длиннее потолка — отказ, а не обрезка: обрезанный ключ повтора
 * перестал бы совпадать сам с собой, а обрезанный номер сделки указал
 * бы на чужую бронь.
 */
const MAX_MERCHANT_FIELD = 200;

function trimmedOrNone(value: string | undefined, subject: string): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > MAX_MERCHANT_FIELD) {
    throw new InvalidInputError(
      `${subject}: не длиннее ${MAX_MERCHANT_FIELD} знаков`,
    );
  }
  return trimmed;
}

/**
 * Чем сужается список заявок владельца.
 *
 * Клиенту хватает потолка: заявок у него единицы, и все они на одном
 * экране. Мерчант читает свои сотнями и страницу продолжает курсором по
 * паре «время подачи и идентификатор» — одного времени мало: две
 * заявки, поданные по API в одну миллисекунду, теряются или дублируются.
 */
export interface OwnExchangeFilter {
  readonly status?: ExchangeRequestStatus | undefined;
  /**
   * Несколько состояний разом: «в работе» — это четыре из шести, и
   * четыре запроса вместо одного экран не ускорят. Задан вместе с
   * `status` — действуют оба, то есть отбирается пересечение.
   */
  readonly statuses?: readonly ExchangeRequestStatus[] | undefined;
  readonly from?: Date | undefined;
  readonly to?: Date | undefined;
  /**
   * Только заявки этого человека внутри мерчанта (тикет 17). Сужает
   * выборку сервер, а не разметка: «мои» иначе означало бы, что
   * приехали все, а часть спрятана — и счётчик под фильтром считал бы
   * не то, что видно.
   */
  readonly submittedByUserId?: string | undefined;
  /**
   * Поиск по своему номеру — куском, без учёта регистра, — или по
   * нашему идентификатору целиком. Это главный путь в список: мерчанту
   * пишут «заказ 1013, где деньги», и ищет он по номеру, который знает
   * его система. Пустая строка — отсутствие поиска, а не пустой ответ:
   * она приезжает из адреса вместе с очищенным полем.
   */
  readonly search?: string | undefined;
  readonly limit?: number | undefined;
  readonly after?: { readonly createdAt: Date; readonly id: string } | undefined;
}

/**
 * Условие поиска. Свой номер ищется с коллацией ICU: база собрана с
 * локалью `C`, и обычный `ilike` «Бронь» на запрос «бронь» не находит —
 * при том что латинские номера ищутся, и на глаз поиск выглядит рабочим.
 *
 * Наш идентификатор сравнивается только целиком и только когда запрос
 * на него похож: по куску `uuid` база не ищет, а непохожую строку в
 * сравнении с ним отвергает ошибкой, а не пустотой.
 */
function searchedFor(raw: string | undefined): SQL | undefined {
  const asked = raw?.trim() ?? '';
  if (!asked) return undefined;
  const byReference = cyrillicLike(exchangeRequests.reference, likePattern(asked));
  return isUuid(asked) ? or(byReference, eq(exchangeRequests.id, asked)) : byReference;
}

/**
 * Условия отбора своих заявок — одни на список, счёт и раскладку по
 * состояниям. До поиска они были записаны дважды, слово в слово; третья
 * копия разошлась бы с первыми на первой же правке, и счётчик таба
 * считал бы не то, что показано под ним.
 */
function ownConditions(
  owner: Owner,
  filter: Omit<OwnExchangeFilter, 'limit' | 'after'>,
): SQL[] {
  const conditions: SQL[] = [ownedBy(owner)];
  if (filter.status) conditions.push(eq(exchangeRequests.status, filter.status));
  if (filter.statuses?.length) {
    conditions.push(inArray(exchangeRequests.status, [...filter.statuses]));
  }
  if (filter.from) conditions.push(gte(exchangeRequests.createdAt, filter.from));
  if (filter.to) conditions.push(lte(exchangeRequests.createdAt, filter.to));
  if (filter.submittedByUserId) {
    conditions.push(eq(exchangeRequests.submittedByUserId, filter.submittedByUserId));
  }
  const searched = searchedFor(filter.search);
  if (searched) conditions.push(searched);
  return conditions;
}

/** Столько заявок отдаётся за раз, когда предел не назван. */
const OWN_REQUESTS_LIMIT = CLIENT_HISTORY_LIMIT;
/** Потолок предела: страница крупнее не читается, а копится в памяти. */
const OWN_REQUESTS_MAX = 200;

export async function listExchangeRequests(
  ctx: CoreConfig,
  actor: Actor,
  filter: OwnExchangeFilter = {},
): Promise<readonly ExchangeRequestView[]> {
  const owner = requireOwner(actor);
  const conditions = ownConditions(owner, filter);
  if (filter.after) {
    /*
     * Пара «время и идентификатор» — двумя условиями, а не кортежем в
     * сыром `sql`: без колонки рядом драйвер не знает, что перед ним
     * дата, и отправлял её строкой — вторая страница отвечала
     * пятисотым. Типизированные операторы переводят `Date` сами; так
     * же устроен курсор очереди в `exchange-workflow.ts`.
     */
    conditions.push(
      or(
        lt(exchangeRequests.createdAt, filter.after.createdAt),
        and(
          eq(exchangeRequests.createdAt, filter.after.createdAt),
          lt(exchangeRequests.id, filter.after.id),
        ),
      )!,
    );
  }

  // Незакрытая заявка в этот кусок попадает всегда: она живёт часами, а
  // потолок отсекает полсотни более свежих — столько за это время
  // руками не подать.
  const rows = await ctx.db
    .select()
    .from(exchangeRequests)
    .where(and(...conditions))
    .orderBy(desc(exchangeRequests.createdAt), desc(exchangeRequests.id))
    .limit(Math.min(filter.limit ?? OWN_REQUESTS_LIMIT, OWN_REQUESTS_MAX));
  return rows.map(toExchangeRequestView);
}

/**
 * Сколько своих заявок у владельца — с теми же условиями отбора, что и
 * список.
 *
 * Нужен табам кабинета и счётчику в меню: число за табом отвечает на
 * вопрос «сколько там», не открывая его, а посчитать его длиной
 * страницы нельзя — страница ограничена пределом, и «50» означало бы и
 * пятьдесят, и пятьсот. Курсор здесь не при чём и не читается: считают
 * всё, а не хвост после последней показанной строки.
 */
export async function countExchangeRequests(
  ctx: CoreConfig,
  actor: Actor,
  filter: Omit<OwnExchangeFilter, 'limit' | 'after'> = {},
): Promise<number> {
  const owner = requireOwner(actor);
  const conditions = ownConditions(owner, filter);

  const [row] = await ctx.db
    .select({ total: count() })
    .from(exchangeRequests)
    .where(and(...conditions));

  return row?.total ?? 0;
}

/**
 * Сколько своих заявок в каждом состоянии — одним запросом.
 *
 * Экран кабинета спрашивает сразу обо всех табах и о счётчике в меню, а
 * состояний шесть: шесть запросов «сколько там» вместо одного — это
 * шесть заходов в базу на каждое тихое обновление, то есть каждые
 * полминуты у каждой открытой вкладки.
 */
export async function countExchangeRequestsByStatus(
  ctx: CoreConfig,
  actor: Actor,
  /**
   * Поиск и даты сужают и раскладку: числа на плитках обязаны считать
   * то, что показано под ними, иначе над двумя строками за неделю стояло
   * бы «Исполнены 10». Состояния сюда не передаются намеренно: раскладка
   * по состояниям и есть ответ.
   */
  filter: Pick<OwnExchangeFilter, 'search' | 'from' | 'to'> = {},
): Promise<Readonly<Record<ExchangeRequestStatus, number>>> {
  const owner = requireOwner(actor);
  const rows = await ctx.db
    .select({ status: exchangeRequests.status, total: count() })
    .from(exchangeRequests)
    .where(and(...ownConditions(owner, filter)))
    .groupBy(exchangeRequests.status);

  // Состояние, которого у владельца нет, — это ноль, а не отсутствие
  // ключа: экран считает по ним суммы и рисует табы.
  const counted: Record<ExchangeRequestStatus, number> = {
    new: 0,
    in_progress: 0,
    rate_confirmed: 0,
    payment_received: 0,
    completed: 0,
    cancelled: 0,
  };
  for (const row of rows) {
    counted[row.status] = row.total;
  }
  return counted;
}

/** Заявки владельца — клиента или мерчанта. */
export function ownedBy(owner: Owner): SQL {
  return owner.kind === 'client'
    ? eq(exchangeRequests.clientId, owner.clientId)
    : eq(exchangeRequests.merchantId, owner.merchantId);
}

/**
 * Куда ушли деньги по заявке — запись получателя для владельца заявки.
 *
 * Отдельная операция, а не список получателей: поданная по API запись
 * архивируется сразу при подаче, чтобы список не рос на каждую заявку,
 * и `listRequisites` её не отдаёт. У заявок интеграции запись была
 * всегда и не была видна никогда — а «туда ли вы перевели» мерчант
 * спрашивает первым делом, когда жалуется покупатель.
 *
 * Отдаётся то, что видно без расшифровки: вид, банк или сеть, открытый
 * хвост. Полного номера здесь нет и быть не может — приватного ключа в
 * клиентском контуре нет (ADR-0002), да он и не нужен: сверяют хвост.
 * Чужая заявка — «не найдена», как везде. Заявка без получателя
 * отвечает пустотой, а не ошибкой: наличной он и не положен.
 */
export async function getExchangeRequestRecipient(
  ctx: CoreConfig,
  actor: Actor,
  requestId: string,
): Promise<RequisitesView | null> {
  const owner = requireOwner(actor);
  const [request] = await ctx.db
    .select({ requisitesId: exchangeRequests.requisitesId })
    .from(exchangeRequests)
    .where(and(eq(exchangeRequests.id, requestId), ownedBy(owner)))
    .limit(1);
  if (!request) throw new NotFoundError('Заявка не найдена');
  if (!request.requisitesId) return null;

  // Принадлежность записи сверяется отдельно от заявки: ссылка на
  // чужую запись в своей заявке — не повод её показать.
  const [row] = await ctx.db
    .select()
    .from(clientRequisites)
    .where(and(eq(clientRequisites.id, request.requisitesId), requisitesOf(owner)))
    .limit(1);
  return row ? toView(row) : null;
}

/**
 * Заявка на обмен по идентификатору. Чужая заявка не «запрещена», а «не
 * найдена»: отличать одно от другого значило бы подтверждать
 * существование заявки тому, кто её перебирает.
 */
export async function getExchangeRequest(
  ctx: CoreConfig,
  actor: Actor,
  requestId: string,
): Promise<ExchangeRequestView> {
  const owner = requireOwner(actor);
  const [row] = await ctx.db
    .select()
    .from(exchangeRequests)
    .where(and(eq(exchangeRequests.id, requestId), ownedBy(owner)))
    .limit(1);

  if (!row) {
    throw new NotFoundError('Заявка на обмен не найдена');
  }
  return toExchangeRequestView(row);
}

/** Условия обмена для экрана заявки: направления и минимальная сумма. */
export async function getExchangeTerms(ctx: CoreConfig): Promise<ExchangeTermsView> {
  const pairs = await ctx.db
    .select({
      fromCode: currencyPairs.fromCode,
      toCode: currencyPairs.toCode,
      kind: currencyPairs.kind,
    })
    .from(currencyPairs)
    .where(eq(currencyPairs.isActive, true))
    .orderBy(asc(currencyPairs.fromCode), asc(currencyPairs.toCode), asc(currencyPairs.kind));

  const active = await ctx.db
    .select({ code: currencies.code, kind: currencies.kind })
    .from(currencies)
    .where(eq(currencies.isActive, true))
    .orderBy(asc(currencies.code));

  const settings = await readServiceSettings(ctx.db);
  return {
    pairs,
    currencies: active,
    minAmount: settings.minExchangeAmount,
    minAmountCode: MIN_EXCHANGE_CODE,
    unpaidTtlMinutes: settings.unpaidExchangeRequestTtlMinutes,
  };
}
