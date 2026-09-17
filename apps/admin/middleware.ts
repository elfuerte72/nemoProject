import { NextResponse, type NextRequest } from 'next/server';
import { PAGE_PATH_HEADER } from './lib/auth/return-to';
import { crossSiteComplaint, publicHost } from './lib/same-origin';

/**
 * Одна проверка на все маршруты панели: изменяющий запрос — только со
 * страницы самой панели (`lib/same-origin.ts`).
 *
 * Здесь, а не в каждом маршруте: маршрутов за тридцать, и новый
 * заводят, не вспоминая о подделке запросов, — забытая проверка ничем
 * себя не выдаёт. Ядра middleware не касается: оно работает в
 * пограничном рантайме, где `@nemo/core` нет, — поэтому правило
 * приходит из `@nemo/http/same-origin`, а не из `@nemo/http`.
 *
 * Страницам он кладёт в запрос их собственный путь: серверный компонент
 * адреса не знает, а истёкшая сессия должна увести на вход с адресом
 * возврата (`lib/auth/return-to.ts`). Заголовок ставится поверх того, что
 * прислал браузер, — путь берётся из адреса запроса, а не с его слов.
 */
export function middleware(request: NextRequest): NextResponse {
  const complaint = crossSiteComplaint({
    method: request.method,
    pathname: request.nextUrl.pathname,
    origin: request.headers.get('origin'),
    fetchSite: request.headers.get('sec-fetch-site'),
    host: publicHost(request.headers),
    contentType: request.headers.get('content-type'),
  });
  if (complaint) {
    return NextResponse.json({ error: complaint }, { status: 403 });
  }

  if (request.nextUrl.pathname.startsWith('/api/')) {
    return NextResponse.next();
  }
  const headers = new Headers(request.headers);
  headers.set(PAGE_PATH_HEADER, `${request.nextUrl.pathname}${request.nextUrl.search}`);
  return NextResponse.next({ request: { headers } });
}

/*
 * Маршруты API — ради проверки, страницы — ради пути возврата. Статика
 * (`/_next/…`, файлы с расширением вроде `icon.svg`) мимо: её отдают без
 * сессии, и копировать для неё заголовки незачем.
 */
export const config = {
  matcher: ['/api/:path*', '/((?!api/|_next/|.*\\.[^/]+$).*)'],
};
