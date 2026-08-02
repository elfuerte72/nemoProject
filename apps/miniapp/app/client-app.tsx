'use client';

import { useCallback, useEffect, useState, type ReactElement } from 'react';
import type { ClientView } from '@nemo/core';
import { ApiError, post } from '@/lib/client-api';
import { getWebApp } from '@/lib/telegram/webapp';
import { BonusSection } from './bonus-section';
import { CardSection } from './card-section';
import { ExchangeScreen } from './exchange-screen';
import { MarketingConsent } from './marketing-consent';
import {
  NemoMark,
  QuestionIcon,
  TabBonusIcon,
  TabCardIcon,
  TabExchangeIcon,
} from './ui/icons';
import { NoticeSheet } from './ui/sheet';

/**
 * Оболочка клиентского приложения: разделы и первый запуск.
 *
 * Клиент создаётся здесь, до того как разделы запросят свои данные:
 * порядок важен — заявки и баллы принадлежат клиенту, которого ещё
 * может не быть. Реферальная привязка тоже выполняется здесь, потому
 * что только тут `telegram_user_id` подтверждён подписью.
 *
 * Разделы переключаются нижней панелью и размонтируются при уходе:
 * каждый спрашивает своё у сервера сам, и держать все три в памяти
 * значило бы грузить при запуске то, за чем клиент не пришёл.
 */

type Tab = 'exchange' | 'bonus' | 'card';

/** Что открыть в разделе бонусов, когда туда ведёт кнопка с другого экрана. */
export type BonusIntent = 'withdraw' | 'invite';

const TABS: readonly {
  id: Tab;
  label: string;
  Icon: (props: { filled: boolean }) => ReactElement;
}[] = [
  { id: 'exchange', label: 'Обмен', Icon: TabExchangeIcon },
  { id: 'bonus', label: 'Бонусы', Icon: TabBonusIcon },
  { id: 'card', label: 'Карта', Icon: TabCardIcon },
];

const SUPPORT = {
  title: 'Поддержка',
  body: 'Менеджер отвечает в чате бота — обычно за несколько минут. Закройте приложение, чтобы вернуться в переписку, и напишите свой вопрос.',
};

/**
 * Насколько должно ужаться окно, чтобы считать это клавиатурой. Адресная
 * строка и панели браузера отъедают заметно меньше.
 */
const KEYBOARD_MIN_PX = 120;

/**
 * Открыта ли экранная клавиатура.
 *
 * Спрашивается у окна, а не у полей ввода: полей на экранах много, они
 * лежат и в листах, и вешать на каждое пару обработчиков — значит
 * однажды пропустить одно. Клавиатура же одна, и она ужимает видимую
 * часть окна, не трогая его собственную высоту.
 */
function useKeyboardOpen(): boolean {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;

    const check = () => setOpen(window.innerHeight - viewport.height > KEYBOARD_MIN_PX);
    check();
    viewport.addEventListener('resize', check);
    return () => viewport.removeEventListener('resize', check);
  }, []);

  return open;
}

export function ClientApp() {
  const [tab, setTab] = useState<Tab>('exchange');
  // Направление перехода: экраны в панели лежат слева направо, и лист
  // должен въезжать с той стороны, куда клиент двинулся.
  const [back, setBack] = useState(false);
  const [bonusIntent, setBonusIntent] = useState<BonusIntent>();
  const [client, setClient] = useState<ClientView>();
  const [support, setSupport] = useState(false);
  const [error, setError] = useState<string>();

  const keyboard = useKeyboardOpen();

  useEffect(() => {
    const webApp = getWebApp();
    webApp?.ready();
    webApp?.expand();
    webApp?.disableVerticalSwipes?.();

    void (async () => {
      try {
        const session = await post<{ client: ClientView }>('/api/session');
        setClient(session.client);
      } catch (failure) {
        setError(failure instanceof ApiError ? failure.message : 'Не удалось открыть сервис');
      }
    })();
  }, []);

  const go = useCallback(
    (next: Tab, intent?: BonusIntent) => {
      setBack(TABS.findIndex((one) => one.id === next) < TABS.findIndex((one) => one.id === tab));
      setTab(next);
      setBonusIntent(intent);
    },
    [tab],
  );

  const openBonus = useCallback((intent: BonusIntent) => go('bonus', intent), [go]);
  const clearIntent = useCallback(() => setBonusIntent(undefined), []);

  return (
    <div className="app">
      <div className="app__glow" />

      <header className="app__header">
        <span className="app__brand">
          <NemoMark />
          Nemo
        </span>
        <button
          type="button"
          onClick={() => setSupport(true)}
          className="icon-btn"
          aria-label="Поддержка"
        >
          <QuestionIcon />
        </button>
      </header>

      {error ? (
        <div className="app__center">
          <p className="error">{error}</p>
        </div>
      ) : !client ? (
        // Пока клиента нет, разделы не показываются: они спрашивают у
        // сервера то, что принадлежит клиенту, и получили бы отказ.
        <div className="app__center">
          <p className="muted">Загружаем…</p>
        </div>
      ) : (
        <div className={keyboard ? 'app__scroll app__scroll--bare' : 'app__scroll'}>
          <div key={tab} className={back ? 'app__screen app__screen--back' : 'app__screen'}>
            {tab === 'exchange' ? <ExchangeScreen onBonus={openBonus} /> : undefined}
            {tab === 'bonus' ? (
              <BonusSection intent={bonusIntent} onIntentShown={clearIntent} />
            ) : undefined}
            {tab === 'card' ? <CardSection /> : undefined}
          </div>

          {/*
            Вопрос висит, пока клиент на него не ответил, а не только при
            первом запуске: закрывший приложение до ответа иначе не увидел
            бы его больше никогда. Отписка потом остаётся здесь же — внизу
            любого экрана, а не в настройках, которых у приложения нет.
          */}
          <MarketingConsent
            askNow={!client.marketingConsentAsked}
            consent={client.marketingConsent}
            onAnswered={(marketingConsent) =>
              setClient({ ...client, marketingConsent, marketingConsentAsked: true })
            }
          />
        </div>
      )}

      {/*
        Под открытой клавиатурой панель садится ей на крышку и закрывает
        то самое поле, ради которого клавиатуру и вызвали. Переключать
        разделы посреди ввода суммы всё равно незачем.
      */}
      {keyboard ? undefined : (
        <>
          <div className="app__fade" />
          <nav className="tabbar">
            {TABS.map(({ id, label, Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => go(id)}
                className="tabbar__item"
                aria-current={tab === id ? 'page' : undefined}
              >
                <Icon filled={tab === id} />
                <span>{label}</span>
              </button>
            ))}
          </nav>
        </>
      )}

      {support ? (
        <NoticeSheet title={SUPPORT.title} body={SUPPORT.body} onClose={() => setSupport(false)} />
      ) : undefined}
    </div>
  );
}
