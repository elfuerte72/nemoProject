'use client';

import { useCallback, useEffect, useState, type ReactElement } from 'react';
import type { ClientView } from '@nemo/core';
import { ApiError, post } from '@/lib/client-api';
import { getWebApp } from '@/lib/telegram/webapp';
import { BonusSection } from './bonus-section';
import { CardSection } from './card-section';
import { ExchangeScreen } from './exchange-screen';
import { MarketingConsentAsk } from './marketing-consent';
import { TabBonusIcon, TabCardIcon, TabExchangeIcon } from './ui/icons';

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

const TABS: readonly {
  id: Tab;
  label: string;
  Icon: (props: { filled: boolean }) => ReactElement;
}[] = [
  { id: 'exchange', label: 'Обмен', Icon: TabExchangeIcon },
  { id: 'bonus', label: 'Бонусы', Icon: TabBonusIcon },
  { id: 'card', label: 'Карта', Icon: TabCardIcon },
];

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
  const [client, setClient] = useState<ClientView>();
  const [error, setError] = useState<string>();

  const keyboard = useKeyboardOpen();

  useEffect(() => {
    const webApp = getWebApp();
    webApp?.ready();
    webApp?.expand();
    webApp?.disableVerticalSwipes?.();
    // Шапка Telegram над приложением — потерянная полоса экрана, а
    // форма обмена и без того помещается впритык. Где метод не
    // поддержан, окно просто останется обычным: отступы считаются по
    // переменным Telegram, а они в этом случае нулевые.
    webApp?.requestFullscreen?.();

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
    (next: Tab) => {
      setBack(TABS.findIndex((one) => one.id === next) < TABS.findIndex((one) => one.id === tab));
      setTab(next);
    },
    [tab],
  );

  return (
    <div className="app">
      <div className="app__glow" />

      {/*
        Шапка пуста намеренно: знак сервиса и кнопка помощи из неё
        убраны — полоса экрана дороже того, что они сообщали. Сам отступ
        остаётся: без него первый экран уезжает под вырез и под кнопки
        Telegram в полноэкранном режиме.
      */}
      <div className="app__safe-top" />

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
            {tab === 'exchange' ? <ExchangeScreen /> : undefined}
            {tab === 'bonus' ? (
              <BonusSection
                consent={client.marketingConsent}
                onConsentChanged={(marketingConsent) => setClient({ ...client, marketingConsent })}
              />
            ) : undefined}
            {tab === 'card' ? <CardSection /> : undefined}
          </div>

        </div>
      )}

      {/*
        Под открытой клавиатурой панель садится ей на крышку и закрывает
        то самое поле, ради которого клавиатуру и вызвали. Переключать
        разделы посреди ввода суммы всё равно незачем.
      */}
      {keyboard ? undefined : (
        <>
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

      {/*
        Вопрос висит, пока клиент на него не ответил, и поверх любого
        раздела: закрывший приложение до ответа иначе не увидел бы его
        больше никогда.
      */}
      {client && !client.marketingConsentAsked ? (
        <MarketingConsentAsk
          onAnswered={(marketingConsent) =>
            setClient({ ...client, marketingConsent, marketingConsentAsked: true })
          }
        />
      ) : undefined}
    </div>
  );
}
