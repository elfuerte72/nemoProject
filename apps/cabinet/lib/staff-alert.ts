/**
 * Позвать панель разослать сотрудникам новую заявку мерчанта.
 *
 * То же, что делает Mini App после заявки клиента
 * (`apps/miniapp/lib/staff-alert.ts`), и по той же причине: уведомлять
 * сотрудников умеет только панель — шлёт их бот входа, чей токен лежит
 * только в её деплое (docs/adr/0005). Кабинет стучится в её маршрут тем
 * же секретом, каким туда ходит планировщик, ответа не ждёт, а отказ
 * только пишет в журнал: расписание всё равно разошлёт.
 */
export function nudgeStaffAlerts(): void {
  const url = process.env.ADMIN_URL;
  const secret = process.env.SCHEDULER_SECRET;
  if (!url || !secret) {
    console.warn('Толчок в панель не настроен: нет ADMIN_URL или SCHEDULER_SECRET');
    return;
  }

  void fetch(`${url.replace(/\/+$/, '')}/api/staff/notify`, {
    method: 'POST',
    headers: { authorization: `Bearer ${secret}` },
  })
    .then((response) => {
      if (!response.ok) {
        console.error('Панель отклонила толчок', response.status);
      }
    })
    .catch((error: unknown) => {
      console.error('Не удалось позвать панель', error);
    });
}
