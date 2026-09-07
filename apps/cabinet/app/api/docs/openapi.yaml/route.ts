import { errorResponse } from '@/lib/api';
import { requireActor } from '@/lib/auth';
import { apiDocSource } from '@/lib/openapi';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Сам файл договора — для генераторов клиентов и для тех, кто читает
 * YAML охотнее страницы. За сессией, как и страница: договор не
 * секрет, но и не витрина.
 */
export async function GET(): Promise<Response> {
  try {
    await requireActor();
    return new Response(apiDocSource, {
      headers: { 'content-type': 'application/yaml; charset=utf-8' },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
