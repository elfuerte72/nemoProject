/**
 * Устройство словами — «macOS · Chrome» — из строки браузера, для
 * раздела «Сессии». Грубо и намеренно: человеку надо узнать свой вход,
 * а не версию сборки, и незнакомое лучше назвать системой, чем
 * выдумать браузер.
 *
 * Порядок проверок — часть правила: Edge, Opera и Яндекс называют себя
 * ещё и Chrome, Chrome на iPhone — ещё и Safari, а iPhone — ещё и
 * «like Mac OS X».
 */

const SYSTEMS: readonly [RegExp, string][] = [
  [/iPhone/, 'iPhone'],
  [/iPad/, 'iPad'],
  [/Android/, 'Android'],
  [/Windows NT/, 'Windows'],
  [/CrOS/, 'ChromeOS'],
  [/Macintosh|Mac OS X/, 'macOS'],
  [/Linux|X11/, 'Linux'],
];

const BROWSERS: readonly [RegExp, string][] = [
  [/YaBrowser\//, 'Яндекс Браузер'],
  [/Edg(A|iOS)?\//, 'Edge'],
  [/OPR\/|Opera/, 'Opera'],
  [/Firefox\/|FxiOS\//, 'Firefox'],
  [/Chrome\/|CriOS\//, 'Chrome'],
  [/Version\/[\d.]+.*Safari\//, 'Safari'],
];

export function deviceLabel(userAgent: string | null): string {
  const text = userAgent?.trim();
  if (!text) return 'Неизвестное устройство';

  const system = SYSTEMS.find(([pattern]) => pattern.test(text))?.[1];
  const browser = BROWSERS.find(([pattern]) => pattern.test(text))?.[1];
  if (system && browser) return `${system} · ${browser}`;
  if (system) return system;
  if (browser) return browser;

  // Не браузер — curl, скрипт, библиотека: их называет первое слово.
  return text.split(/[\s/]/)[0] || 'Неизвестное устройство';
}
