import { Money, type Amount } from '@nemo/types';
import { InvalidInputError } from './errors.js';

/**
 * Разбор денежной величины, пришедшей из запроса.
 *
 * Величина приходит строкой и строкой же уходит в базу: через `number`
 * дробная часть криптовалюты потерялась бы ещё до проверки. Название
 * величины передаётся отдельно, чтобы отказ говорил, какое именно поле
 * заполнено неверно, — «сумма должна быть больше нуля» на экране с
 * тремя суммами не помогает.
 */
export function requirePositiveAmount(value: string, subject: string): Amount {
  const parsed = Money.positiveAmountSchema.safeParse(value);
  if (!parsed.success) {
    // Двоеточием, а не связкой: подставляется и «Сумма заявки», и
    // «Курс», и согласовать их в одном шаблоне по-русски нельзя.
    throw new InvalidInputError(`${subject}: ожидается число больше нуля`);
  }
  return parsed.data;
}
