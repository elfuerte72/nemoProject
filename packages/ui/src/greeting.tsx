'use client';

import { useEffect, useState } from 'react';
import { dayWords, salute } from './greeting-words.js';

/**
 * Приветствие по часам того, кто смотрит.
 *
 * Сервер живёт в UTC, и «доброе утро» с него приходило бы в обед —
 * что менеджеру, что мерчанту. Час и дата берутся у браузера после первого показа; до этого —
 * нейтральное «Здравствуйте», и разметка сервера с клиентской не
 * расходятся.
 */
export function Greeting({ name }: { name: string }) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
  }, []);

  return (
    <>
      <p className="page__eyebrow" suppressHydrationWarning>
        {now ? dayWords(now) : ' '}
      </p>
      <h1 className="page__title" suppressHydrationWarning>
        {now ? `${salute(now.getHours())}, ${name}` : `Здравствуйте, ${name}`}
      </h1>
    </>
  );
}
