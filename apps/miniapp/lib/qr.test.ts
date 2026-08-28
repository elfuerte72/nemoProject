import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { looksLikeAlipayQr, parsePromptPay } from '@nemo/types';
import { fitWithin, readQrPixels, type Pixels } from './qr';

/**
 * Чтение QR из картинки — той же функцией, что работает в браузере.
 *
 * Картинка на Node читается `pngjs` в те же пиксели, что отдаёт холст в
 * браузере, и дальше путь один. Доказывается, что библиотека читает
 * картинку, а не наше представление о ней; сами картинки пока собраны
 * генератором по стандарту — оригиналы владельца запрошены и заменят
 * их (`backlog.md`).
 */
function pixelsOf(name: string): Pixels {
  const png = PNG.sync.read(readFileSync(new URL(`./qr-fixtures/${name}`, import.meta.url)));
  return {
    data: new Uint8ClampedArray(png.data.buffer, png.data.byteOffset, png.data.length),
    width: png.width,
    height: png.height,
  };
}

describe('readQrPixels', () => {
  it('читает PromptPay-QR из кошелька', () => {
    const payload = readQrPixels(pixelsOf('promptpay-ewallet.png'));

    expect(payload).toBe(
      '00020101021129390016A000000677010111031514000000000061453037645802TH63042D0B',
    );
    expect(parsePromptPay(payload ?? '')).toEqual({
      ok: true,
      idType: 'ewallet',
      id: '140000000000614',
    });
  });

  it('читает PromptPay-QR из банка с телефоном', () => {
    const payload = readQrPixels(pixelsOf('promptpay-phone.png'));

    expect(parsePromptPay(payload ?? '')).toMatchObject({ ok: true, idType: 'phone' });
  });

  it('читает QR приёма Alipay, набранный прописными', () => {
    const payload = readQrPixels(pixelsOf('alipay.png'));

    expect(payload).toBe('HTTPS://QR.ALIPAY.COM/FKX12345ABCD');
    expect(looksLikeAlipayQr(payload ?? '')).toBe(true);
  });

  it('находит QR на скриншоте телефона среди остального экрана', () => {
    // 1080 × 1920: тёмный фон приложения, белая карточка, QR в ней и
    // строки «текста» под ним — так выглядит снимок из галереи.
    const payload = readQrPixels(pixelsOf('screenshot-truemoney.png'));

    expect(parsePromptPay(payload ?? '')).toMatchObject({ ok: true, id: '140000000000614' });
  });

  it('на картинке без QR отвечает пустотой, а не бросает', () => {
    const blank: Pixels = { data: new Uint8ClampedArray(64 * 64 * 4).fill(255), width: 64, height: 64 };

    expect(readQrPixels(blank)).toBeNull();
  });
});

/*
 * Картинка уменьшается до разбора: скриншот с телефона — четыре-восемь
 * мегапикселей, и слабое устройство такой холст в памяти не удержит.
 * Уменьшается по большей стороне и никогда не увеличивается.
 */
describe('fitWithin', () => {
  it('ужимает скриншот по большей стороне, сохраняя пропорцию', () => {
    expect(fitWithin(1080, 1920, 1000)).toEqual({ width: 563, height: 1000 });
    expect(fitWithin(4000, 3000, 1000)).toEqual({ width: 1000, height: 750 });
  });

  it('маленькую картинку не трогает', () => {
    expect(fitWithin(400, 400, 1000)).toEqual({ width: 400, height: 400 });
  });
});
