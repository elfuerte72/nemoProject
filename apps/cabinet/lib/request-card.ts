import type { ExchangeRequestSource, ExchangeRequestStatus } from '@nemo/types';

/**
 * Что карточка заявки говорит о реквизитах — по состоянию заявки.
 *
 * Реквизиты у заявки появляются при подтверждении курса и остаются с
 * ней до конца: у оплаченной, у исполненной, у отменённой. Блок же
 * «Куда платить» показывался всякий раз, когда они есть, — и 21
 * сентября 2026 исполненная заявка звала платить, называла срок и
 * обещала, что сервис её отменит.
 *
 * Правило живёт здесь, а не в разметке: ошибка в нём про деньги. Призыв
 * платить у отменённой заявки — это перевод, которого никто не ждёт, а
 * по реквизитам он всё равно уйдёт.
 */

export interface PaymentBlock {
  /** Зовём платить, показываем запись об оплате или отговариваем. */
  readonly kind: 'pay' | 'paid' | 'void';
  readonly title: string;
  readonly note: string;
  /** Называть ли срок оплаты: он значит что-то, только пока платят. */
  readonly deadline: boolean;
}

const BLOCKS: Record<PaymentBlock['kind'], PaymentBlock> = {
  pay: {
    kind: 'pay',
    title: 'Куда платить',
    note: 'Проверьте получателя перед переводом: деньги, ушедшие по опечатке, не возвращаются.',
    deadline: true,
  },
  paid: {
    kind: 'paid',
    title: 'Куда платили',
    note: 'Оплата по этой заявке получена, платить больше не нужно. Реквизиты оставлены для сверки.',
    deadline: false,
  },
  void: {
    kind: 'void',
    title: 'Реквизиты больше не действуют',
    note: 'Заявка отменена, не платите по ним. Если перевод уже ушёл, напишите в поддержку.',
    deadline: false,
  },
};

/**
 * Состояние — в вид блока. Записано таблицей по всем состояниям, а не
 * условием «если ждёт оплаты»: новое состояние заявки не соберётся,
 * пока здесь не решат, что при нём говорить о реквизитах.
 */
const BY_STATUS: Record<ExchangeRequestStatus, PaymentBlock['kind'] | null> = {
  // До подтверждения курса реквизитов ядро не пишет. Взявшиеся откуда-то
  // раньше срока платить не зовут: курс ещё не назван.
  new: null,
  in_progress: null,
  rate_confirmed: 'pay',
  payment_received: 'paid',
  completed: 'paid',
  cancelled: 'void',
};

export function paymentBlockOf(request: {
  readonly status: ExchangeRequestStatus;
  readonly paymentInstructions: string | null;
}): PaymentBlock | null {
  if (!request.paymentInstructions) return null;
  const kind = BY_STATUS[request.status];
  return kind === null ? null : BLOCKS[kind];
}

/* ── Строка пути ─────────────────────────────────────────────────── */

/**
 * Где заявка и кого она ждёт.
 *
 * Пилюля состояния отвечает «где», но не отвечает на то, зачем карточку
 * открывают: кто сейчас ходит и что будет дальше. «Курс подтверждён»
 * значит «ждёт вашей оплаты», и по двум словам об этом не догадаться.
 * Объяснение раньше лежало абзацем над списком заявок; нужно оно здесь,
 * про текущий шаг этой заявки.
 */
export interface RequestPath {
  readonly steps: readonly {
    readonly label: string;
    /** Пройден, текущий, впереди — или тот, на котором заявку отменили. */
    readonly state: 'done' | 'current' | 'ahead' | 'stopped';
  }[];
  /** Одно предложение о текущем шаге: кто ходит и что случится дальше. */
  readonly note: string;
  /** Ждёт ли заявка самого мерчанта: такое отмечается медовым. */
  readonly waitsForMerchant: boolean;
}

/*
 * Шагов четыре, а состояний у открытой заявки пять: «новая» и «в
 * работе» для мерчанта — один шаг. Разница между ними — взял ли заявку
 * менеджер, — и мерчанту она ничего не меняет: в обоих случаях он ждёт
 * курса.
 */
const STEP_LABELS = ['Новая', 'Курс подтверждён', 'Оплата получена', 'Исполнена'] as const;

/** Состояние — в номер шага. Отменённая своего шага не имеет. */
const STEP_OF: Record<ExchangeRequestStatus, number | null> = {
  new: 0,
  in_progress: 0,
  rate_confirmed: 1,
  payment_received: 2,
  completed: 3,
  cancelled: null,
};

const PATH_NOTES: Record<ExchangeRequestStatus, string> = {
  new: 'Заявка у менеджера: он назовёт курс и выдаст реквизиты для оплаты.',
  in_progress: 'Менеджер взял заявку в работу: назовёт курс и выдаст реквизиты для оплаты.',
  rate_confirmed: 'Ждёт вашей оплаты. Реквизиты и срок стоят ниже.',
  payment_received: 'Оплата получена, отправляем деньги получателю.',
  completed: 'Исполнена: деньги отправлены получателю.',
  cancelled: 'Отменена на этом шаге, дальше заявка не пошла. Причина стоит ниже.',
};

export function pathOf(request: {
  readonly status: ExchangeRequestStatus;
  /**
   * До какого состояния заявка дошла перед отменой — из её истории. Без
   * истории отменённая оборвалась на первом шаге: так и есть у заявки,
   * которую мерчант отменил сам, пока её не взяли.
   */
  readonly reached?: ExchangeRequestStatus | undefined;
}): RequestPath {
  const cancelled = request.status === 'cancelled';
  const at = cancelled
    ? ((request.reached ? STEP_OF[request.reached] : null) ?? 0)
    : (STEP_OF[request.status] ?? 0);
  const finished = request.status === 'completed';

  return {
    steps: STEP_LABELS.map((label, index) => ({
      label,
      state:
        index < at || finished
          ? 'done'
          : index > at
            ? 'ahead'
            : cancelled
              ? 'stopped'
              : 'current',
    })),
    note: PATH_NOTES[request.status],
    waitsForMerchant: request.status === 'rate_confirmed',
  };
}

/* ── Срок оплаты ─────────────────────────────────────────────────── */

/** Сколько минут до конца срока считается «срочно». */
const SOON_MINUTES = 15;

export interface PaymentDeadline {
  /** До какого момента платить. Печатает его браузер, а не сервер. */
  readonly at: Date;
  /** Целых минут осталось — вверх: идёт последняя минута, значит «1». */
  readonly leftMinutes: number;
  /**
   * `over` — срок вышел, а заявка ещё не отменена: отменяет её
   * планировщик, а не сам срок, и в этом промежутке экран говорит об
   * этом словами, а не показывает ноль или минус.
   */
  readonly state: 'ok' | 'soon' | 'over';
}

/**
 * Срок оплаты — моментом и остатком. Раньше карточка говорила
 * «реквизиты выданы в 17:07, на оплату — 120 мин», и складывать время с
 * минутами мерчант должен был сам. Считать срок — работа сервиса: он же
 * его и назначил.
 */
export function paymentDeadlineOf(
  issuedAt: Date | null,
  ttlMinutes: number,
  now: Date,
): PaymentDeadline | null {
  if (!issuedAt) return null;
  const at = new Date(issuedAt.getTime() + ttlMinutes * 60_000);
  const left = Math.ceil((at.getTime() - now.getTime()) / 60_000);
  if (left <= 0) return { at, leftMinutes: 0, state: 'over' };
  return { at, leftMinutes: left, state: left < SOON_MINUTES ? 'soon' : 'ok' };
}

/**
 * Остаток — часами и минутами, а не десятичной дробью. У `formatMinutes`
 * из `@nemo/ui` «1,2 ч» — так читается среднее время до исполнения; а
 * обратный отсчёт сверяют с часами на стене, и «1,2 ч» человек
 * переводит в минуты сам.
 */
export function leftWords(minutes: number): string {
  if (minutes < 60) return `${minutes} мин`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} ч` : `${hours} ч ${rest} мин`;
}

/* ── Откуда заявка ───────────────────────────────────────────────── */

/**
 * Как заявка подана — словами для подзаголовка карточки: «подана по
 * API». Пустой источник слов не имеет: у поданных до появления отметки
 * он не записан, и угаданный читался бы как записанный.
 *
 * В списке заявок источника нет намеренно. Колонка «Кто подал» стояла
 * там до 21 сентября 2026 и говорила «по ключу API» на любую пустоту; а
 * колонка «Источник» говорила бы «API» в каждой строке — подаёт заявки
 * только интеграция. Столбец, одинаковый во всех строках, — не столбец.
 */
export const SUBMITTED_VIA: Record<ExchangeRequestSource, string> = {
  api: 'по API',
  cabinet: 'из кабинета',
  miniapp: 'из Mini App',
};
