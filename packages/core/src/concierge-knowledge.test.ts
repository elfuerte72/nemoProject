import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { conciergeKnowledge } from '@nemo/db';
import { closeTestDatabase, resetDatabase, testDatabase } from '@nemo/db/testing';
import { createCore, type Actor } from './index.js';
import type { KnowledgeDraftRequest, KnowledgeDrafter } from './knowledge-drafter.js';
import { givenStaff } from './test-support.js';

/**
 * База знаний помощника: как в неё попадают статьи.
 *
 * Руками — одна статья за раз; документом — модель делит текст на
 * статьи, ядро причёсывает их и показывает черновиком, а записывает
 * только то, что администратор подтвердил. Модель подменена: здесь
 * проверяются правила ядра — что заменяется, что делится, о чём
 * предупреждается, — а не её сообразительность.
 */

const db = testDatabase();

function givenDrafter(
  articles: readonly { title: string; body: string }[] | null,
  options: { truncated?: boolean } = {},
): KnowledgeDrafter & { readonly requests: KnowledgeDraftRequest[] } {
  const requests: KnowledgeDraftRequest[] = [];
  return {
    requests,
    draft: async (request) => {
      requests.push(request);
      return articles === null ? null : { articles, truncated: options.truncated ?? false };
    },
  };
}

function coreWith(drafter?: KnowledgeDrafter) {
  return createCore({ db, ...(drafter ? { knowledgeDrafter: drafter } : {}) });
}

let admin: Actor & { type: 'staff' };
let manager: Actor & { type: 'staff' };

beforeEach(async () => {
  await resetDatabase();
  admin = await givenStaff({ role: 'admin', displayName: 'Анна' });
  manager = await givenStaff({ role: 'manager', displayName: 'Пётр' });
});

afterAll(() => closeTestDatabase());

describe('статья руками', () => {
  it('без позиции встаёт в конец справки', async () => {
    const core = coreWith();
    await core.saveKnowledgeArticle(admin, { title: 'График', body: 'Круглосуточно.', position: 40 });

    const added = await core.saveKnowledgeArticle(admin, { title: 'Оплата', body: 'СБП и карта.' });

    expect(added.position).toBeGreaterThan(40);
    const titles = (await core.listKnowledgeArticles(admin)).map((one) => one.title);
    expect(titles).toEqual(['График', 'Оплата']);
  });

  it('при правке без позиции остаётся на своём месте', async () => {
    const core = coreWith();
    const first = await core.saveKnowledgeArticle(admin, { title: 'График', body: 'Круглосуточно.', position: 40 });
    await core.saveKnowledgeArticle(admin, { title: 'Оплата', body: 'СБП и карта.', position: 50 });

    const edited = await core.saveKnowledgeArticle(admin, {
      id: first.id,
      title: 'График работы',
      body: 'Круглосуточно и без выходных.',
    });

    expect(edited.position).toBe(40);
    const titles = (await core.listKnowledgeArticles(admin)).map((one) => one.title);
    expect(titles).toEqual(['График работы', 'Оплата']);
  });
});

describe('черновик из документа', () => {
  it('без источника черновика отказывает словами: разбор выключен', async () => {
    const core = coreWith();

    await expect(core.draftKnowledgeArticles(admin, { text: 'Работаем круглосуточно.' })).rejects.toThrow(
      /выключен/,
    );
    expect(core.hasKnowledgeDrafter()).toBe(false);
  });

  it('пустой текст не разбирается', async () => {
    const core = coreWith(givenDrafter([]));

    await expect(core.draftKnowledgeArticles(admin, { text: '  \n ' })).rejects.toThrow(/пуст/i);
  });

  it('менеджеру не отдаётся: состав знаний решает администратор', async () => {
    const core = coreWith(givenDrafter([]));

    await expect(core.draftKnowledgeArticles(manager, { text: 'Текст' })).rejects.toMatchObject({
      code: 'forbidden',
    });
  });

  it('отдаёт модели инструкцию редактора и сам текст', async () => {
    const drafter = givenDrafter([{ title: 'График', body: 'Круглосуточно.' }]);
    const core = coreWith(drafter);

    await core.draftKnowledgeArticles(admin, { text: '  Работаем круглосуточно.  ' });

    expect(drafter.requests).toHaveLength(1);
    expect(drafter.requests[0]?.text).toBe('Работаем круглосуточно.');
    expect(drafter.requests[0]?.instructions).toContain('статьи');
  });

  it('молчание провайдера — отказ, который можно повторить, а не пустой черновик', async () => {
    const core = coreWith(givenDrafter(null));

    await expect(core.draftKnowledgeArticles(admin, { text: 'Текст' })).rejects.toMatchObject({
      code: 'unavailable',
    });
  });

  it('предупреждает о сроке в статье: помощник сможет его обещать', async () => {
    const core = coreWith(
      givenDrafter([
        { title: 'Сроки', body: 'Перевод идёт до часа.' },
        { title: 'График', body: 'Круглосуточно.' },
      ]),
    );

    const draft = await core.draftKnowledgeArticles(admin, { text: 'Документ' });

    expect(draft.articles[0]?.warnings.join(' ')).toMatch(/срок/);
    expect(draft.articles[1]?.warnings).toEqual([]);
  });

  it('предупреждает о машинном ритме теми же словами, что и тексты бота', async () => {
    const core = coreWith(
      givenDrafter([{ title: 'Курс', body: 'Курс -- включает всё.' }]),
    );

    const draft = await core.draftKnowledgeArticles(admin, { text: 'Документ' });

    expect(draft.articles[0]?.warnings.join(' ')).toMatch(/дефис/);
  });

  it('предупреждает о совете от себя, которого в документе не было', async () => {
    const core = coreWith(
      givenDrafter([
        { title: 'Оплата', body: 'Оплата по СБП. Пожалуйста, уточняйте реквизиты у менеджера.' },
        { title: 'Наличные', body: 'Рекомендуем договориться о встрече заранее.' },
      ]),
    );

    const draft = await core.draftKnowledgeArticles(admin, {
      text: 'Оплата по СБП. Наличные: рекомендуем договориться о встрече заранее.',
    });

    expect(draft.articles[0]?.warnings).toEqual([
      '«пожалуйста»: в документе этого не было, дописано от себя',
      '«уточняйте»: в документе этого не было, дописано от себя',
    ]);
    // Слово из самого документа — не совет от себя.
    expect(draft.articles[1]?.warnings).toEqual([]);
  });

  it('длинную статью делит по абзацам на части, а не отвергает', async () => {
    const paragraph = 'Абзац о сервисе. '.repeat(100).trim(); // ≈ 1 700 знаков
    const body = [paragraph, paragraph, paragraph].join('\n\n'); // ≈ 5 100 — длиннее потолка
    const core = coreWith(givenDrafter([{ title: 'Как проходит обмен', body }]));

    const draft = await core.draftKnowledgeArticles(admin, { text: 'Документ' });

    expect(draft.articles.map((one) => one.title)).toEqual([
      'Как проходит обмен (1)',
      'Как проходит обмен (2)',
    ]);
    for (const article of draft.articles) {
      expect(article.body.length).toBeLessThanOrEqual(4000);
    }
    expect(draft.articles.map((one) => one.body).join('\n\n')).toBe(body);
  });

  it('абзац длиннее потолка делит по предложениям', async () => {
    const body = 'Предложение о сервисе номер раз. '.repeat(200).trim(); // ≈ 6 600 без переносов
    const core = coreWith(givenDrafter([{ title: 'Правила', body }]));

    const draft = await core.draftKnowledgeArticles(admin, { text: 'Документ' });

    expect(draft.articles.length).toBeGreaterThan(1);
    for (const article of draft.articles) {
      expect(article.body.length).toBeLessThanOrEqual(4000);
      expect(article.body.endsWith('.')).toBe(true);
    }
  });

  it('пустые и безымянные статьи выбрасывает, названия и тексты обрезает по краям', async () => {
    const core = coreWith(
      givenDrafter([
        { title: '', body: 'Без названия.' },
        { title: 'Пустая', body: '   ' },
        { title: '  Оплата  ', body: '  СБП и карта.  ' },
      ]),
    );

    const draft = await core.draftKnowledgeArticles(admin, { text: 'Документ' });

    expect(draft.articles).toHaveLength(1);
    expect(draft.articles[0]).toMatchObject({ title: 'Оплата', body: 'СБП и карта.' });
  });

  it('слишком длинное название укорачивает по слову', async () => {
    const long = 'Очень длинное название '.repeat(10).trim();
    const core = coreWith(givenDrafter([{ title: long, body: 'Текст.' }]));

    const draft = await core.draftKnowledgeArticles(admin, { text: 'Документ' });

    const title = draft.articles[0]!.title;
    expect(title.length).toBeLessThanOrEqual(120);
    expect(long.startsWith(title)).toBe(true);
    // Отрезано по пробелу, а не посреди слова.
    expect(long[title.length]).toBe(' ');
  });

  it('говорит, что документ разобран не целиком, если модель упёрлась в потолок', async () => {
    const core = coreWith(givenDrafter([{ title: 'График', body: 'Круглосуточно.' }], { truncated: true }));

    const draft = await core.draftKnowledgeArticles(admin, { text: 'Документ' });

    expect(draft.truncated).toBe(true);
  });

  it('документ длиннее потолка отвергает словами, а не молча режет', async () => {
    const core = coreWith(givenDrafter([]));

    await expect(
      core.draftKnowledgeArticles(admin, { text: 'x'.repeat(60_001) }),
    ).rejects.toThrow(/длин/);
  });
});

describe('запись черновика', () => {
  it('записывает статьи в конец справки в том порядке, в каком подтвердили', async () => {
    const core = coreWith();
    await core.saveKnowledgeArticle(admin, { title: 'График', body: 'Круглосуточно.', position: 40 });

    const saved = await core.addKnowledgeArticles(admin, [
      { title: 'Оплата', body: 'СБП и карта.' },
      { title: 'Наличные', body: 'Курс назовёт менеджер.' },
    ]);

    expect(saved.map((one) => one.title)).toEqual(['Оплата', 'Наличные']);
    const titles = (await core.listKnowledgeArticles(admin)).map((one) => one.title);
    expect(titles).toEqual(['График', 'Оплата', 'Наличные']);
  });

  it('одноимённую статью заменяет на месте и возвращает в справку, если была погашена', async () => {
    const core = coreWith();
    const old = await core.saveKnowledgeArticle(admin, { title: 'График', body: 'Старый.', position: 40 });
    await core.saveKnowledgeArticle(admin, { title: 'Оплата', body: 'СБП.', position: 50 });
    await core.setKnowledgeArticleActive(admin, old.id, false);

    await core.addKnowledgeArticles(admin, [{ title: 'график', body: 'Круглосуточно.' }]);

    const all = await core.listKnowledgeArticles(admin);
    expect(all).toHaveLength(2);
    expect(all[0]).toMatchObject({ id: old.id, title: 'график', body: 'Круглосуточно.', position: 40, isActive: true });
  });

  it('пустой черновик не записывается', async () => {
    const core = coreWith();

    await expect(core.addKnowledgeArticles(admin, [])).rejects.toMatchObject({ code: 'invalid-input' });
  });

  it('одна негодная статья не даёт записать остальные: черновик правят целиком', async () => {
    const core = coreWith();

    await expect(
      core.addKnowledgeArticles(admin, [
        { title: 'Оплата', body: 'СБП и карта.' },
        { title: '', body: 'Без названия.' },
      ]),
    ).rejects.toMatchObject({ code: 'invalid-input' });

    expect(await db.select().from(conciergeKnowledge)).toHaveLength(0);
  });

  it('менеджеру запись не разрешена', async () => {
    const core = coreWith();

    await expect(
      core.addKnowledgeArticles(manager, [{ title: 'Оплата', body: 'СБП.' }]),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });
});
