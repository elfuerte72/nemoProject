/**
 * Шина событий POS-терминала: кто-то изменил счёт или возврат —
 * открытые вкладки кабинета узнают об этом сразу.
 *
 * В процессе, а не в базе: записи макета живут в памяти процесса, и
 * событие о них дальше процесса идти не может. Когда счета переедут в
 * базу, здесь встанет `NOTIFY` через ядро, как у панели (docs/adr/0014),
 * а слушатели и поток `/api/pos/stream` останутся теми же.
 *
 * Событие несёт только тему и идентификатор: что изменилось, вкладка
 * узнаёт, перечитав свой экран. В долго открытый поток не попадает
 * ничего о деньгах, тем же правилом, что у панели.
 */

export interface PosEvent {
  readonly kind: 'invoice' | 'refund' | 'settings';
  readonly id: string;
}

type Listener = (event: PosEvent) => void;

const KEY = Symbol.for('nemo.cabinet.pos-bus');

type Holder = typeof globalThis & { [KEY]?: Map<string, Set<Listener>> };

/** На `globalThis`, как память макета: у Next свой экземпляр модуля на бандл. */
function rooms(): Map<string, Set<Listener>> {
  const holder = globalThis as Holder;
  holder[KEY] ??= new Map();
  return holder[KEY];
}

export function publishPos(merchantId: string, event: PosEvent): void {
  for (const listener of rooms().get(merchantId) ?? []) {
    try {
      listener(event);
    } catch {
      // Упавший слушатель — его беда, а не соседей: событие обязано
      // дойти до остальных вкладок.
    }
  }
}

/** Слушать события своего мерчанта. Возвращает отписку. */
export function subscribePos(merchantId: string, listener: Listener): () => void {
  const room = rooms().get(merchantId) ?? new Set<Listener>();
  room.add(listener);
  rooms().set(merchantId, room);
  return () => {
    room.delete(listener);
    if (room.size === 0) rooms().delete(merchantId);
  };
}

/** Сколько вкладок слушает мерчанта. Нужно тестам и только им. */
export function listenersOf(merchantId: string): number {
  return rooms().get(merchantId)?.size ?? 0;
}
