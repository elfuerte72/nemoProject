'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Копирование с отметкой «Скопировано».
 *
 * Одно на все места, где что-то копируют: реферальную ссылку в профиле и
 * реквизиты для оплаты в заявке. Две копии этой мелочи разошлись бы
 * сроком показа отметки — и одно и то же нажатие в двух местах
 * отзывалось бы по-разному.
 *
 * Отказ буфера проглатывается молча: копирование — не то действие,
 * ради которого стоит показывать клиенту ошибку, а выделить текст
 * пальцем он может и сам. Молча — но не мигая отметкой: она поднимается
 * только на состоявшемся копировании, иначе сказала бы неправду.
 */

/** Сколько «Скопировано» держится на месте кнопки. */
const COPIED_MS = 1600;

export function useCopied(): {
  readonly copied: boolean;
  readonly copy: (text: string) => void;
} {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  /**
   * Жив ли ещё тот, кто копировал. Буфер отвечает обещанием, и ответ
   * приходит после закрытия листа так же легко, как до: лист закрывают
   * тем же нажатием, которым копируют.
   */
  const alive = useRef(true);

  // Отметка снимается по сроку, и снявший её таймер переживает уход
  // листа: сработав в пустоту, он ругался бы в консоль на каждое
  // копирование перед закрытием.
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      clearTimeout(timer.current);
    };
  }, []);

  const copy = useCallback((text: string) => {
    void navigator.clipboard
      ?.writeText(text)
      .then(() => {
        if (!alive.current) return;
        setCopied(true);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), COPIED_MS);
      })
      .catch(() => {
        // Буфер закрыт настройками или недоступен в этом клиенте.
      });
  }, []);

  return { copied, copy };
}
