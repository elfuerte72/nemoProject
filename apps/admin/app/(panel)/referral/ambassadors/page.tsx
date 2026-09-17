import Link from 'next/link';
import { CoreError } from '@nemo/core';
import { firstParam, HowTo } from '@nemo/ui';
import { requireStaffPage } from '@/lib/auth/require-session';
import { getCore } from '@/lib/core';
import { AMBASSADORS_HOW_TO } from '@/lib/referral-texts';
import { Ambassadors } from './ambassadors';

export const dynamic = 'force-dynamic';

/**
 * Премиальные партнёры — подраздел «Рефералки», администратору.
 *
 * В коде и в базе они амбассадоры, на экране — премиальные партнёры:
 * так их зовёт владелец. Термин и подпись здесь расходятся намеренно,
 * и менять при случае надо подпись, а не термин.
 *
 * Менеджеру страница не прячется, а отказывает словами: операция и так
 * ему откажет, а спрятанная ссылка — видимость разграничения, а не оно
 * само.
 */
export default async function AmbassadorsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { actor } = await requireStaffPage();

  const query = firstParam((await searchParams).q) ?? '';

  try {
    const list = await getCore().listAmbassadors(actor, { query });
    return (
      <main className="page page--wide">
        <header className="page__head">
          <div>
            <h1 className="page__title">Премиальные партнёры</h1>
            <p className="page__sub">
              Блогеры, чаты и каналы, которых сервис позвал в программу поимённо
            </p>
          </div>
          <div className="page__actions">
            <Link href="/referral" className="btn btn--ghost">
              Сводка рефералки
            </Link>
          </div>
        </header>

        <HowTo
          title="Как устроены премиальные партнёры"
          sub="Отметка, ставка, снятие"
          items={AMBASSADORS_HOW_TO}
        />

        <Ambassadors rows={list} query={query} />
      </main>
    );
  } catch (error) {
    if (error instanceof CoreError && error.code === 'forbidden') {
      return (
        <main className="page page--wide">
          <p className="empty">
            Раздел доступен только администратору: здесь решают, кому платят по премиальной
            ставке. Нужен по работе — попросите администратора.
          </p>
        </main>
      );
    }
    throw error;
  }
}
