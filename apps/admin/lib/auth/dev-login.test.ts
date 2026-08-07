import { describe, expect, it } from 'vitest';
import { devLoginAllowed } from './dev-login';

/**
 * Когда панель пускает без двух факторов.
 *
 * Правило про доступ, и потому оно вынесено из маршрута и покрыто
 * тестом: обход входа, который однажды сработает на живом сервисе, —
 * это вся панель в чужих руках. Проверять его нажатием нельзя, ошибка
 * видна только там, где уже поздно.
 */

describe('вход для разработки', () => {
  it('в разработке и по явному разрешению — пускает', () => {
    expect(devLoginAllowed({ nodeEnv: 'development', flag: '1' })).toBe(true);
  });

  /*
   * Одной сборки для разработки мало: `next dev` поднимают и на общей
   * машине, и в контейнере с настоящей базой. Разрешение спрашивается
   * отдельной переменной, которую заводят руками.
   */
  it('без явного разрешения не пускает даже в разработке', () => {
    expect(devLoginAllowed({ nodeEnv: 'development', flag: undefined })).toBe(false);
    expect(devLoginAllowed({ nodeEnv: 'development', flag: '' })).toBe(false);
    expect(devLoginAllowed({ nodeEnv: 'development', flag: '0' })).toBe(false);
  });

  /*
   * А в проде не пускает ни при каких. Переменная, забытая в окружении
   * или поставленная по ошибке, не должна открывать вход: это ровно тот
   * случай, ради которого правило и написано.
   */
  it('в проде не пускает никогда', () => {
    expect(devLoginAllowed({ nodeEnv: 'production', flag: '1' })).toBe(false);
    expect(devLoginAllowed({ nodeEnv: 'production', flag: 'true' })).toBe(false);
  });

  /*
   * Неизвестное окружение считается продом. `NODE_ENV` задаётся не
   * только сборкой, и пустое значение при разворачивании — обычное
   * дело; трактовать его как разработку значило бы открывать вход
   * ровно тогда, когда о нём не подумали.
   */
  it('незнакомое окружение считает продом', () => {
    expect(devLoginAllowed({ nodeEnv: undefined, flag: '1' })).toBe(false);
    expect(devLoginAllowed({ nodeEnv: 'staging', flag: '1' })).toBe(false);
  });
});
