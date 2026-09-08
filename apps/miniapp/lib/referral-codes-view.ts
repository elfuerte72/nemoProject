import { promoCodeSchema, type ReferralCodeKind } from '@nemo/types';
import { referralLink } from './referral';

/**
 * Коды клиента на экране: что мешает завести новый, куда ведёт ссылка
 * и как ею делятся.
 *
 * Препятствие называется до отправки тем же правилом, каким отвергнет
 * ядро: у промокода это `promoCodeSchema` из `@nemo/types`, одна на
 * форму и операцию. Разойдясь, форма приняла бы слово, которое ядро
 * вернёт отказом.
 */

export interface NewCodeDraft {
  readonly kind: ReferralCodeKind;
  readonly label: string;
  readonly code: string;
}

const LABEL_LIMIT = 40;

export function newCodeObstacle(draft: NewCodeDraft): string | null {
  const label = draft.label.trim();
  if (label.length === 0) {
    return 'Назовите код: «сторис», «канал», «друзья» — так видно, откуда приходят';
  }
  if (label.length > LABEL_LIMIT) {
    return `Название — до ${LABEL_LIMIT} знаков`;
  }
  if (draft.kind === 'promo') {
    const parsed = promoCodeSchema.safeParse(draft.code);
    if (!parsed.success) return parsed.error.issues[0]?.message ?? 'Промокод не подходит';
  }
  return null;
}

/** Ссылка у кода-ссылки; промокод показывается словом, адреса у него нет. */
export function codeLink(code: { readonly kind: ReferralCodeKind; readonly code: string }): string | undefined {
  return code.kind === 'link' ? referralLink(code.code) : undefined;
}

/** «Поделиться» в Telegram: адрес и текст сообщения. */
export function shareUrl(link: string, text: string): string {
  return `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`;
}
