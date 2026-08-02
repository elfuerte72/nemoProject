import { redirect } from 'next/navigation';
import { CoreError } from '@nemo/core';
import { requireStaffActorOrNull } from '@/lib/auth/require-session';
import { getCore } from '@/lib/core';

export const dynamic = 'force-dynamic';

/**
 * Журнал доступа к реквизитам.
 *
 * Только на чтение и только администратору: менеджер — тот, за кем этот
 * журнал и ведётся, и доступ к нему у проверяемого обесценивает саму
 * проверку. Правки и удаления не предусмотрены — восстановить задним
 * числом, кто и когда видел чужой номер карты, невозможно.
 *
 * Отбор задаётся параметрами адреса: так отобранный список можно
 * переслать коллеге ссылкой, не пересказывая, что в нём выбрано.
 */
export default async function RequisiteAccessPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireStaffActorOrNull();
  if (!actor) {
    redirect('/login');
  }

  const params = await searchParams;
  const single = (key: string): string | undefined => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };

  const clientId = single('clientId');
  const staffId = single('staffId');
  const from = single('from');
  const to = single('to');

  try {
    const core = getCore();
    const [entries, staff] = await Promise.all([
      core.listRequisiteAccessLog(actor, {
        staffId: staffId || undefined,
        clientId: clientId ? BigInt(clientId) : undefined,
        from: from ? new Date(`${from}T00:00:00.000Z`) : undefined,
        // Конец дня, а не его начало: поле даёт дату, а обращения в
        // выбранный день произошли уже после полуночи, и граница по ней
        // выкидывала бы из отбора весь последний день.
        to: to ? new Date(`${to}T23:59:59.999Z`) : undefined,
      }),
      core.listStaff(actor),
    ]);

    return (
      <main className="page">
        <header className="page__head">
          <div>
            <h1 className="page__title">Журнал доступа к реквизитам</h1>
            <p className="page__sub">
              Кто и когда открывал чужие номера карт. Только чтение: записи не правятся и
              не удаляются.
            </p>
          </div>
          <span className="section__count">{entries.length}</span>
        </header>

        <form method="get" className="card">
          <div className="form-row">
            <label className="field field--narrow">
              <span className="label">Клиент</span>
              <input className="input" name="clientId" defaultValue={clientId ?? ''} inputMode="numeric" />
            </label>
            {/* Списком, а не полем: идентификатор сотрудника администратор
                наизусть не помнит, а вписывать его руками — не отбор. */}
            <label className="field">
              <span className="label">Сотрудник</span>
              <select className="input" name="staffId" defaultValue={staffId ?? ''}>
                <option value="">Любой</option>
                {staff.map((one) => (
                  <option key={one.id} value={one.id}>
                    {one.displayName}
                  </option>
                ))}
              </select>
            </label>
            <label className="field field--narrow">
              <span className="label">С даты</span>
              <input className="input" name="from" type="date" defaultValue={from ?? ''} />
            </label>
            <label className="field field--narrow">
              <span className="label">По дату</span>
              <input className="input" name="to" type="date" defaultValue={to ?? ''} />
            </label>
            <button type="submit" className="btn btn--soft">
              Отобрать
            </button>
          </div>
        </form>

        {entries.length === 0 ? (
          <p className="empty">Обращений к реквизитам не было.</p>
        ) : (
          <ul className="rows">
            {entries.map((entry) => (
              <li key={entry.id} className="row">
                <div className="row__main">
                  <span className="row__title">{entry.staffName}</span>
                  <span className="row__meta">
                    клиент {entry.clientId.toString()}
                    {entry.exchangeRequestId
                      ? ` · карта по заявке на обмен ${entry.exchangeRequestId.slice(0, 8)}`
                      : ''}
                    {entry.withdrawalRequestId
                      ? ` · реквизиты по заявке на вывод ${entry.withdrawalRequestId.slice(0, 8)}`
                      : ''}
                  </span>
                </div>
                <span className="row__meta">
                  {new Date(entry.accessedAt).toLocaleString('ru-RU')}
                </span>
              </li>
            ))}
          </ul>
        )}
      </main>
    );
  } catch (error) {
    if (error instanceof CoreError && error.code === 'forbidden') {
      return (
        <main className="page">
          <h1 className="page__title">Журнал доступа к реквизитам</h1>
          <p className="empty">Журнал доступен только администратору.</p>
        </main>
      );
    }
    throw error;
  }
}
