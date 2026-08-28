// Как собраны картинки в этой папке. Запуск из `apps/miniapp`:
//   node lib/qr-fixtures/make.mjs
//
// Строки — те же, что в тестах доменных типов: PromptPay по стандарту
// EMVCo с приложением перевода и CRC-16/CCITT-FALSE, ссылка Alipay
// прописными. «Скриншот» — тёмный фон приложения, белая карточка, QR в
// ней и строки «текста» под ним: так выглядит снимок из галереи.
// Оригиналы владельца, когда придут, кладутся сюда же и заменяют эти.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import { PNG } from 'pngjs';

// `qrcode` лежит в корне монорепо (панель рисует им QR второго фактора).
const QRCode = createRequire(import.meta.url)('qrcode');
const dir = new URL('./', import.meta.url).pathname;

const EWALLET = '00020101021129390016A000000677010111031514000000000061453037645802TH63042D0B';
const PHONE = '00020101021129370016A0000006770101110113006681234567853037645802TH6304823E';
const ALIPAY = 'HTTPS://QR.ALIPAY.COM/FKX12345ABCD';

async function qrPng(text, width) {
  const buffer = await QRCode.toBuffer(text, { type: 'png', width, margin: 2, errorCorrectionLevel: 'M' });
  return PNG.sync.read(buffer);
}

fs.writeFileSync(`${dir}promptpay-ewallet.png`, PNG.sync.write(await qrPng(EWALLET, 400)));
fs.writeFileSync(`${dir}promptpay-phone.png`, PNG.sync.write(await qrPng(PHONE, 300)));
fs.writeFileSync(`${dir}alipay.png`, PNG.sync.write(await qrPng(ALIPAY, 320)));

const shot = new PNG({ width: 1080, height: 1920 });
const fill = (x0, y0, w, h, r, g, b) => {
  for (let y = y0; y < y0 + h; y += 1) {
    for (let x = x0; x < x0 + w; x += 1) {
      const at = (y * shot.width + x) * 4;
      shot.data[at] = r;
      shot.data[at + 1] = g;
      shot.data[at + 2] = b;
      shot.data[at + 3] = 255;
    }
  }
};
fill(0, 0, 1080, 1920, 24, 26, 34);
fill(120, 420, 840, 1080, 255, 255, 255);
for (let line = 0; line < 6; line += 1) fill(160, 1320 + line * 28, 400 + (line % 3) * 120, 14, 60, 60, 60);
fill(160, 200, 500, 40, 230, 230, 230);
PNG.bitblt(await qrPng(EWALLET, 640), shot, 0, 0, 640, 640, 220, 520);
fs.writeFileSync(`${dir}screenshot-truemoney.png`, PNG.sync.write(shot));
