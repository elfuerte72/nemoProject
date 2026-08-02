import { describe, expect, it } from 'vitest';
import { addressEdges, generateRequisiteKeyPair, lastFour, open, seal } from './index.js';

const keys = generateRequisiteKeyPair();
const CARD = '4276 3800 1234 4821';

/** Портит один байт конверта, не трогая остальные. */
function flipByte(envelope: Buffer, index: number): Buffer {
  envelope.writeUInt8(envelope.readUInt8(index) ^ 0xff, index);
  return envelope;
}

describe('шифрование реквизитов', () => {
  it('расшифровывает то, что зашифровали', () => {
    expect(open(keys.privateKey, seal(keys.publicKey, CARD))).toBe(CARD);
  });

  it('даёт разный шифротекст на одинаковый ввод', () => {
    // Эфемерная пара на каждое сообщение: одинаковые карты не выглядят одинаково,
    // иначе по базе было бы видно, у скольких клиентов совпадают реквизиты.
    const a = seal(keys.publicKey, CARD);
    const b = seal(keys.publicKey, CARD);
    expect(a.equals(b)).toBe(false);
  });

  it('не расшифровывается чужим приватным ключом', () => {
    const stranger = generateRequisiteKeyPair();
    expect(() => open(stranger.privateKey, seal(keys.publicKey, CARD))).toThrow();
  });

  it('обнаруживает подмену шифротекста', () => {
    const envelope = seal(keys.publicKey, CARD);
    expect(() => open(keys.privateKey, flipByte(envelope, envelope.length - 1))).toThrow();
  });

  it('обнаруживает подмену эфемерного ключа', () => {
    const envelope = seal(keys.publicKey, CARD);
    expect(() => open(keys.privateKey, flipByte(envelope, 5))).toThrow();
  });

  it('отвергает конверт неизвестной версии', () => {
    const envelope = seal(keys.publicKey, CARD);
    envelope[0] = 99;
    expect(() => open(keys.privateKey, envelope)).toThrow(RangeError);
  });

  it('отвергает слишком короткий конверт', () => {
    expect(() => open(keys.privateKey, Buffer.of(1, 2, 3))).toThrow(RangeError);
  });

  it('держит юникод и длинные строки', () => {
    const value = 'Сбербанк, счёт №40817810099910004312, получатель Иванов И. И.';
    expect(open(keys.privateKey, seal(keys.publicKey, value))).toBe(value);
  });
});

describe('lastFour', () => {
  it('берёт последние четыре цифры, игнорируя пробелы', () => {
    expect(lastFour(CARD)).toBe('4821');
  });

  it('бросает, если цифр меньше четырёх', () => {
    expect(() => lastFour('12')).toThrow(RangeError);
  });
});

describe('addressEdges', () => {
  it('оставляет начало и конец адреса', () => {
    // Начало нужно не меньше конца: по нему клиент убеждается, что это
    // адрес той сети, которую он выбирал.
    expect(addressEdges('TQmXk9sPzL4nR2vB7cH1dF8gJ5wYt3aU6e')).toBe('TQmX…aU6e');
  });

  it('не прячет короткую строку: скрывать в ней нечего', () => {
    expect(addressEdges('TQmXk9s')).toBe('TQmXk9s');
  });

  it('не оставляет в подсказке середины адреса', () => {
    const address = 'TQmXk9sPzL4nR2vB7cH1dF8gJ5wYt3aU6e';

    expect(addressEdges(address)).not.toContain('R2vB7cH1');
  });
});

describe('ключ без обрамления', () => {
  it('принимается: переменные окружения почти везде однострочные', () => {
    const { publicKey, privateKey } = generateRequisiteKeyPair();
    // Ровно то, что получается, если скопировать ключ в панель
    // развёртывания и потерять строки заголовка.
    const bare = (pem: string) =>
      pem
        .split('\n')
        .filter((line) => !line.startsWith('-----'))
        .join('');

    const sealed = seal(bare(publicKey), '4111111111111111');

    expect(open(bare(privateKey), sealed)).toBe('4111111111111111');
  });

  it('не мешает обычному PEM', () => {
    const { publicKey, privateKey } = generateRequisiteKeyPair();

    expect(open(privateKey, seal(publicKey, 'секрет'))).toBe('секрет');
  });
});
