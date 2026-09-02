import { asc, eq } from 'drizzle-orm';
import { exchangeRequestEvents, exchangeRequests, staff } from '@nemo/db';
import { inProgressExchangeStatuses } from '@nemo/types';
import { requireStaff, type Actor } from './actor.js';
import type { CoreConfig } from './context.js';
import { ForbiddenError, InvalidInputError, TransitionNotAllowedError } from './errors.js';
import { lockRequest, toManagerView, type TransitionResult } from './exchange-workflow.js';

/**
 * Передача заявки другому менеджеру.
 *
 * Заявку ведёт тот, кто её взял, и обхода для администратора у этого
 * правила нет: действуя поверх закрепления, он оставил бы в истории
 * двух исполнителей при одном закреплении. Лечится передача: заявка
 * меняет ведущего целиком, а в истории остаётся, кто, кому и когда.
 *
 * Передаёт либо сам ведущий (ушёл на обед, уехал), либо администратор
 * (ведущий уволился). Забрать чужую себе нельзя — это то же обход
 * закрепления, только с другой стороны.
 *
 * Клиенту ничего не уходит: его процесс не меняется, а «вашу заявку
 * теперь ведёт Анна» читалось бы как тревога без повода.
 */
export interface ReassignExchangeRequestInput {
  readonly toStaffId: string;
}

export async function reassignExchangeRequest(
  ctx: CoreConfig,
  actor: Actor,
  requestId: string,
  input: ReassignExchangeRequestInput,
): Promise<TransitionResult> {
  const who = requireStaff(actor);

  return ctx.db.transaction(async (tx) => {
    const row = await lockRequest(tx, requestId);

    if (!(inProgressExchangeStatuses as readonly string[]).includes(row.status)) {
      throw new TransitionNotAllowedError(
        row.status === 'new'
          ? 'Заявку никто не ведёт — возьмите её в работу, а не передавайте'
          : 'Закрытую заявку передать нельзя',
      );
    }
    if (row.assignedManagerId === null) {
      throw new TransitionNotAllowedError('Заявку никто не ведёт — возьмите её в работу');
    }
    if (who.role !== 'admin' && row.assignedManagerId !== who.staffId) {
      throw new ForbiddenError('Передать заявку может тот, кто её ведёт, или администратор');
    }
    if (row.assignedManagerId === input.toStaffId) {
      throw new InvalidInputError('Этот менеджер уже ведёт заявку');
    }

    const [to] = await tx
      .select({ id: staff.id, displayName: staff.displayName, isActive: staff.isActive })
      .from(staff)
      .where(eq(staff.id, input.toStaffId))
      .limit(1);
    if (!to || !to.isActive) {
      // Одним словом на обе беды: несуществующий и выключенный
      // сотрудник для передачи одинаково недоступны, а перебирающему
      // идентификаторы незачем знать, какой из двух случаев его.
      throw new InvalidInputError('Такого сотрудника нет или доступ ему закрыт');
    }
    const [from] = await tx
      .select({ displayName: staff.displayName })
      .from(staff)
      .where(eq(staff.id, row.assignedManagerId))
      .limit(1);

    const [updated] = await tx
      .update(exchangeRequests)
      .set({ assignedManagerId: to.id, updatedAt: new Date() })
      .where(eq(exchangeRequests.id, row.id))
      .returning();

    /*
     * Событие без смены состояния: `from` и `to` равны. Общий переход
     * такое отвергает — таблица состояний не знает петель, — и это
     * верно для всего, кроме передачи: она меняет не состояние, а
     * ведущего, и в истории обязана остаться.
     */
    await tx.insert(exchangeRequestEvents).values({
      requestId: row.id,
      fromStatus: row.status,
      toStatus: row.status,
      actorType: 'manager',
      actorStaffId: who.staffId,
      comment: `Передана: ${from?.displayName ?? 'прежний менеджер'} → ${to.displayName}`,
    });

    return { request: toManagerView(updated!, null, to.displayName), notifications: [] };
  });
}

export interface ColleagueView {
  readonly id: string;
  readonly displayName: string;
}

/**
 * Кому можно передать: активные сотрудники, только имена.
 *
 * Доступно любому сотруднику, в отличие от полного списка с ролями и
 * состоянием второго фактора, который остаётся администратору: имя
 * коллеги — не секрет, оно и так стоит в колонке «ведёт».
 */
export async function listColleagues(
  ctx: CoreConfig,
  actor: Actor,
): Promise<readonly ColleagueView[]> {
  requireStaff(actor);
  return ctx.db
    .select({ id: staff.id, displayName: staff.displayName })
    .from(staff)
    .where(eq(staff.isActive, true))
    .orderBy(asc(staff.displayName));
}
