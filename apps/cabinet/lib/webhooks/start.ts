import type { Notification } from '@nemo/core';
import { getCore } from '@/lib/core';
import { deliverMail } from '@/lib/mail';
import {
  deliverWebhook,
  processWebhookJob,
  startWebhookWorker,
  type WebhookWorkerDeps,
} from './worker';

/**
 * Воркер с настоящими зависимостями: очередь в базе через ядро, отправка
 * по сети, письма через почту кабинета. Отдельно от самого воркера,
 * чтобы тот проверялся без базы.
 */
export function webhookWorkerDeps(): WebhookWorkerDeps {
  const core = getCore();
  return {
    take: (now, limit) => core.takeDueWebhookDeliveries({ now, limit }),
    record: (deliveryId, result, now) => core.recordWebhookDeliveryResult(deliveryId, result, now),
    deliver: (job) => deliverWebhook(job),
    mail: (notifications: readonly Notification[]) => deliverMail(notifications),
    now: () => new Date(),
  };
}

export function startWebhookWorkerFromEnvironment(): void {
  startWebhookWorker(webhookWorkerDeps());
}

/**
 * Одна доставка прямо сейчас — так «пробное» из кабинета отвечает
 * ответом приёмника, не дожидаясь тика. Берётся только названная
 * строка: чужую очередь запрос мерчанта не разбирает. Пусто — строку
 * уже забрал воркер, и исход придёт тихим обновлением.
 */
export async function deliverWebhookNow(deliveryId: string): Promise<boolean> {
  const deps = webhookWorkerDeps();
  const [job] = await getCore().takeDueWebhookDeliveries({ now: deps.now(), limit: 1, deliveryId });
  if (!job) return false;
  await processWebhookJob(deps, job);
  return true;
}
