import QRCode from 'qrcode';

/**
 * Выдача второго фактора сотруднику.
 *
 * Ключ показывается один раз, и его нужно перенести в приложение-
 * аутентификатор. Переписывать тридцать два знака руками — занятие, на
 * котором ошибаются, а ошибка выглядит как «код не подходит» и уводит
 * разбираться не туда. Поэтому рядом с ключом стоит код для камеры:
 * навёл — и готово.
 *
 * Сам ключ остаётся на экране: телефона под рукой может не быть, а
 * менеджеры паролей принимают его текстом.
 */

const ISSUER = 'nemoProject';

/**
 * Ссылка, которую понимают все аутентификаторы. Имя сотрудника входит в
 * подпись записи — иначе в приложении с десятком служб человек не
 * поймёт, к какой из них относится строка.
 */
export function otpauthUri(displayName: string, secret: string): string {
  const label = encodeURIComponent(`${ISSUER}:${displayName}`);
  const params = new URLSearchParams({
    secret,
    issuer: ISSUER,
    algorithm: 'SHA1',
    digits: '6',
    period: '30',
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/**
 * Код для камеры в виде разметки, а не картинки: страница отдаётся
 * готовой, и отдельный запрос за изображением ключа второго фактора
 * оставил бы его в кэше и в журнале обращений.
 */
export async function enrollmentQr(displayName: string, secret: string): Promise<string> {
  return QRCode.toString(otpauthUri(displayName, secret), {
    type: 'svg',
    margin: 1,
    errorCorrectionLevel: 'M',
  });
}
