import { NextResponse, type NextRequest } from 'next/server';
import { crossSiteComplaint, publicHost } from './lib/same-origin';

/**
 * Одна проверка на все маршруты кабинета: изменяющий запрос — только со
 * страницы самого кабинета (`lib/same-origin.ts`).
 *
 * Здесь, а не в каждом маршруте: маршрутов за сорок, и новый заводят,
 * не вспоминая о подделке запросов, — забытая проверка ничем себя не
 * выдаёт. Ядра middleware не касается: оно работает в пограничном
 * рантайме, где `@nemo/core` нет (`next.config.ts`).
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
  return NextResponse.next();
}

export const config = { matcher: '/api/:path*' };
