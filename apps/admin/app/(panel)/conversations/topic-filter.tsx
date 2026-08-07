'use client';

import { usePathname, useRouter } from 'next/navigation';

/**
 * Отбор обращений по теме.
 *
 * Тем две, потому что вопросов у менеджера два: «где просьбы про
 * деньги» и «где всё остальное». Отель и покупка — обе про оплату
 * продукта, и разводить их в отборе значило бы спрашивать то, чего он
 * не спрашивает; какая именно просьба, видно в самой строке.
 *
 * Подписок здесь нет: их ведёт партнёр, и обращений у нас они не
 * создают. Заявки на карту — тоже: у них свои состояния, и поддержка им
 * не нужна.
 *
 * Живёт отбор в адресе, как и в очереди заявок: сужать список должен
 * сервер, иначе «фильтр» означал бы, что приехало всё, а часть спрятана
 * разметкой.
 */

const TOPICS: readonly { readonly value: string; readonly label: string }[] = [
  { value: '', label: 'Все' },
  { value: 'support', label: 'Поддержка' },
  { value: 'payment', label: 'Оплата продукта' },
];

export function TopicFilter({ topic }: { readonly topic: string }) {
  const router = useRouter();
  const pathname = usePathname();

  return (
    <div className="filters" role="group" aria-label="Тема обращения">
      {TOPICS.map((one) => (
        <button
          key={one.value || 'all'}
          type="button"
          className={one.value === topic ? 'chip chip--on' : 'chip'}
          {...(one.value === topic ? { 'aria-current': 'true' as const } : {})}
          onClick={() =>
            router.replace(one.value ? `${pathname}?topic=${one.value}` : pathname, {
              scroll: false,
            })
          }
        >
          {one.label}
        </button>
      ))}
    </div>
  );
}
