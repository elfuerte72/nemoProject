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
      <main style={styles.page}>
        <h1 style={styles.title}>Журнал доступа к реквизитам</h1>

        <form method="get" style={styles.filters}>
          <input name="clientId" defaultValue={clientId ?? ''} placeholder="Клиент" style={styles.input} />
          {/* Списком, а не полем: идентификатор сотрудника администратор
              наизусть не помнит, а вписывать его руками — не отбор. */}
          <select name="staffId" defaultValue={staffId ?? ''} style={styles.input}>
            <option value="">Любой сотрудник</option>
            {staff.map((one) => (
              <option key={one.id} value={one.id}>
                {one.displayName}
              </option>
            ))}
          </select>
          <input name="from" type="date" defaultValue={from ?? ''} style={styles.input} />
          <input name="to" type="date" defaultValue={to ?? ''} style={styles.input} />
          <button type="submit" style={styles.button}>
            Отобрать
          </button>
        </form>

        {entries.length === 0 ? (
          <p style={styles.muted}>Обращений к реквизитам не было.</p>
        ) : (
          <ul style={styles.list}>
            {entries.map((entry) => (
              <li key={entry.id} style={styles.item}>
                <div>
                  {new Date(entry.accessedAt).toLocaleString('ru-RU')} — {entry.staffName}
                </div>
                <div style={styles.muted}>
                  клиент {entry.clientId.toString()}
                  {entry.exchangeRequestId
                    ? ` · карта по заявке на обмен ${entry.exchangeRequestId.slice(0, 8)}`
                    : ''}
                  {entry.withdrawalRequestId
                    ? ` · реквизиты по заявке на вывод ${entry.withdrawalRequestId.slice(0, 8)}`
                    : ''}
                </div>
              </li>
            ))}
          </ul>
        )}
      </main>
    );
  } catch (error) {
    if (error instanceof CoreError && error.code === 'forbidden') {
      return (
        <main style={styles.page}>
          <h1 style={styles.title}>Журнал доступа к реквизитам</h1>
          <p style={styles.muted}>Журнал доступен только администратору.</p>
        </main>
      );
    }
    throw error;
  }
}

const styles = {
  page: {
    fontFamily: 'system-ui, sans-serif',
    padding: '2rem 1.5rem',
    maxWidth: 720,
    margin: '0 auto',
    display: 'flex',
    flexDirection: 'column',
    gap: '1.5rem',
  },
  title: { fontSize: '1.3rem' },
  filters: { display: 'flex', gap: '0.5rem', flexWrap: 'wrap' },
  input: { padding: '0.5rem', fontSize: '0.9rem', minWidth: '9rem' },
  button: { padding: '0.5rem 0.9rem', fontSize: '0.9rem' },
  list: { listStyle: 'none', padding: 0, display: 'flex', flexDirection: 'column', gap: '0.6rem' },
  item: { borderTop: '1px solid rgba(128,128,128,0.25)', paddingTop: '0.5rem' },
  muted: { opacity: 0.7, fontSize: '0.85rem' },
} satisfies Record<string, React.CSSProperties>;
