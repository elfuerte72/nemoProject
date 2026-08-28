import jsQR from 'jsqr';

/**
 * Чтение QR из картинки — на устройстве клиента.
 *
 * Клиент приносит реквизит картинкой: PromptPay-QR из тайского банка
 * или кошелька, QR приёма Alipay. Картинка расшифровывается здесь, в
 * браузере, и на сервер уходит только строка — шифрованной, как номер
 * карты; сама картинка телефон не покидает (docs/adr/0012).
 *
 * Библиотека — чистый JS без зависимостей, и грузится модуль лениво,
 * в момент показа поля: первый экран его не везёт.
 *
 * Разбор отделён от чтения файла, чтобы тест на Node читал те же
 * фикстурные картинки той же функцией: `pngjs` отдаёт те же пиксели,
 * что и холст в браузере.
 */

export interface Pixels {
  readonly data: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
}

/** Строка из QR — или пусто, если QR на картинке не нашлось. */
export function readQrPixels(pixels: Pixels): string | null {
  // Оба варианта инверсии: скриншот из тёмной темы приложения несёт
  // светлый QR на тёмном фоне.
  const found = jsQR(pixels.data, pixels.width, pixels.height, {
    inversionAttempts: 'attemptBoth',
  });
  return found?.data ? found.data : null;
}

/**
 * До какой стороны ужимается картинка перед разбором.
 *
 * Скриншот с телефона — четыре-восемь мегапикселей, и слабое устройство
 * такой холст в памяти не удержит. Тысячи по большей стороне QR из
 * галереи хватает: на скриншоте он занимает треть экрана и остаётся
 * крупнее трёх сотен точек. Не нашёлся — вторая попытка крупнее: QR,
 * снятый мелко, ужатый вдвое читаться перестаёт.
 */
const FIT_SIDES = [1000, 1800] as const;

/** Размер, в который картинка вписывается по большей стороне; меньшую не увеличивает. */
export function fitWithin(
  width: number,
  height: number,
  max: number,
): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

/**
 * Картинка из галереи → строка из QR. Только в браузере: холст и
 * декодер изображений живут там.
 */
export async function readQrFromImage(file: Blob): Promise<string | null> {
  const bitmap = await decodeImage(file);
  try {
    for (const side of FIT_SIDES) {
      const { width, height } = fitWithin(bitmap.width, bitmap.height, side);
      const found = readQrPixels(draw(bitmap, width, height));
      if (found) return found;
      // Картинка и так меньше следующего порога: повторять нечем.
      if (Math.max(bitmap.width, bitmap.height) <= side) break;
    }
    return null;
  } finally {
    if ('close' in bitmap) bitmap.close();
  }
}

function draw(image: ImageBitmap | HTMLImageElement, width: number, height: number): Pixels {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) {
    throw new Error('Холст недоступен');
  }
  context.drawImage(image, 0, 0, width, height);
  return context.getImageData(0, 0, width, height);
}

/**
 * Декодер картинки: `createImageBitmap`, а где его нет — обычный `<img>`.
 * Внутри Telegram на старых Android WebView первого может не быть, и
 * без запасного пути кнопка выбора картинки там молчала бы.
 */
async function decodeImage(file: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    return createImageBitmap(file);
  }
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('Картинка не открылась'));
      image.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}
