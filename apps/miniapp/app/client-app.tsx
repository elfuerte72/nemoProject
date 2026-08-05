'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import type { ClientView } from '@nemo/core';
import { ApiError, post } from '@/lib/client-api';
import { getWebApp } from '@/lib/telegram/webapp';
import { BonusSection } from './bonus-section';
import { CardSection } from './card-section';
import { ExchangeScreen } from './exchange-screen';
import { MarketingConsentAsk } from './marketing-consent';
import { TabBonusIcon, TabCardIcon, TabExchangeIcon } from './ui/icons';
import { Splash } from './ui/splash';

/**
 * Оболочка клиентского приложения: разделы и первый запуск.
 *
 * Клиент создаётся здесь, до того как разделы запросят свои данные:
 * порядок важен — заявки и баллы принадлежат клиенту, которого ещё
 * может не быть. Реферальная привязка тоже выполняется здесь, потому
 * что только тут `telegram_user_id` подтверждён подписью.
 *
 * Разделы лежат в ряд и переключаются переносом ряда: нижней панелью
 * или пальцем. Показанный однажды раздел из ряда не убирается — иначе
 * соседний, к которому его же и ведут пальцем, приезжал бы пустым.
 *
 * Но и при запуске в ряду он один. Каждый раздел спрашивает своё у
 * сервера сам, и завести все три сразу значило бы на первом же открытии
 * тянуть данные того, за чем клиент не пришёл; сосед заводится тогда,
 * когда за ним потянулись, — по нажатию или по первым же пикселям
 * жеста, до того как он въедет в кадр.
 *
 * Оставшись в ряду, раздел перестал бы обновляться: раньше его данные
 * перечитывались оттого, что при каждом заходе он собирался заново.
 * Поэтому возвращение считается и передаётся разделу — по нему он
 * перечитывает своё, не показывая, что занят.
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
 * Сколько надо увести палец, чтобы стало ясно, ведут его вбок или вниз.
 * До этого порога жест не присвоен никому: решить по первому же пикселю
 * значит отобрать прокрутку у того, кто начал её чуть наискось.
 */
const AXIS_LOCK_PX = 10;

/**
 * Какую долю ширины надо пройти, чтобы раздел сменился. Меньше четверти
 * — и раздел меняется от неловкого движения; больше половины — и
 * донести палец до конца тяжелее, чем нажать кнопку.
 */
const COMMIT_RATIO = 0.28;

/**
 * Полоса у левого края, где жест не начинается. Telegram на iOS
 * забирает свайп от края себе — приложение закрылось бы посреди
 * переноса, и это выглядело бы поломкой, а не системным жестом.
 */
const EDGE_GUARD_PX = 22;

/**
 * Насколько вязким становится перенос за краем ряда. За первым и
 * последним разделом соседа нет, и ряд должен упереться — но не встать
 * намертво: неподвижность читается как зависшее приложение, а
 * замедлившийся ряд — как его край.
 */
const OVERSCROLL_DAMPING = 4;

/**
 * Сколько ждать простоя, прежде чем завести соседние разделы всё равно.
 * На занятом устройстве простоя может не случиться до самого закрытия.
 */
const IDLE_DEADLINE_MS = 2500;

/** То же там, где браузер о простое не сообщает. */
const IDLE_FALLBACK_MS = 1500;

/**
 * Сколько заставка держится, даже если сессия открылась быстрее.
 *
 * Сессия отвечает за доли секунды, и без этого срока приветствие
 * мелькало бы: клиент успевает заметить движение и не успевает понять,
 * что это было. Две с половиной секунды — столько, чтобы талисмана
 * узнали, и не столько, чтобы вход начал раздражать.
 *
 * Срок именно нижний, а не показ по таймеру: сессия бывает и медленнее,
 * и тогда заставка остаётся до ответа.
 */
const SPLASH_HOLD_MS = 2500;

/**
 * Сколько заставка ждёт первый экран, прежде чем уйти без него.
 *
 * У запросов нет срока, и зависший ответ держал бы приветствие до
 * закрытия приложения: клиент смотрел бы на дышащий свет, не зная, что
 * всё сломалось. По этому потолку заставка уходит и отдаёт экран как
 * есть — со своей строкой о загрузке. Строка эта хуже приветствия, но
 * она хотя бы говорит правду о том, что происходит.
 *
 * Отсчёт от запуска, а не от конца срока показа: считать нужно то,
 * сколько клиент смотрит на экран, а не сколько ждёт приложение.
 */
const SPLASH_LIMIT_MS = 7000;

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

/**
 * Позвать Telegram, пережив отказ.
 *
 * Разворачивание окна появилось в Bot API 7.7 и 8.0, и в клиенте
 * постарше эти методы на объекте всё равно есть — необязательный вызов
 * их не пропускает. Отвечают они не отказом, а исключением
 * `WebAppMethodUnsupported`, и брошенное из эффекта роняет приложение
 * целиком: вместо обычного окна вместо полноэкранного клиент увидел бы
 * пустой экран с сообщением об ошибке.
 */
function tolerate(call: () => void): void {
  try {
    call();
  } catch {
    // Этот клиент так не умеет. Приложение остаётся в обычном окне — на
    // это и рассчитаны отступы: без разворота переменные Telegram
    // нулевые, и полоса под шапку просто не занимает места.
  }
}

export function ClientApp() {
  const [tab, setTab] = useState<Tab>('exchange');
  const [client, setClient] = useState<ClientView>();
  const [error, setError] = useState<string>();
  /** Отстояла ли заставка свой срок. */
  const [greeted, setGreeted] = useState(false);
  /** Вышло ли время, которое заставка ждёт первый экран. */
  const [waited, setWaited] = useState(false);
  /**
   * Досказал ли своё первый экран. Заставка ждёт и этого: она лежит
   * поверх, экран грузится под ней, и уйти ей можно только тогда, когда
   * под ней уже не «загружаем направления обмена», а сам обмен.
   */
  const [screenReady, setScreenReady] = useState(false);
  /** Разделы, заведённые в ряду. Порядок в ряду задаёт `TABS`. */
  const [mounted, setMounted] = useState<readonly Tab[]>(['exchange']);
  /** Сколько раз в раздел возвращались: по этому числу он перечитывает своё. */
  const [visits, setVisits] = useState<Readonly<Record<Tab, number>>>({
    exchange: 0,
    bonus: 0,
    card: 0,
  });
  const keyboard = useKeyboardOpen();
  const viewport = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);

  const index = TABS.findIndex((one) => one.id === tab);

  /**
   * Ряд разделов стоит под заставкой с той минуты, как появился клиент:
   * первый экран спрашивает своё, пока идёт приветствие, и к его концу
   * уже готов. Раньше ряда под заставкой не было вовсе — экран начинал
   * грузиться после её ухода, и клиент видел вместо него строку
   * «загружаем».
   */
  const shown = Boolean(client);

  /**
   * Сессия не ответила и не отказала за отведённое время.
   *
   * Отказ приходит сообщением, ответ — клиентом, а молчание не приходит
   * никак: у запроса нет срока, и ждать его можно до закрытия
   * приложения. Приветствие в этом случае висело бы вечно и выглядело
   * бы работающим — самый плохой вид поломки из возможных.
   */
  const stalled = waited && !client && !error;

  /**
   * Пора ли снимать заставку: срок вышел и есть что показать вместо неё.
   *
   * «Есть что показать» — готовый экран, отказ сессии (сообщение и есть
   * ответ), её молчание или вышедший потолок ожидания под уже стоящим
   * экраном. Последнее условие именно с проверкой клиента: снимать
   * заставку, когда под ней пусто, значило бы менять приветствие на
   * пустое поле.
   */
  const greetingOver =
    greeted && (screenReady || Boolean(error) || stalled || (Boolean(client) && waited));

  useEffect(() => {
    const hold = setTimeout(() => setGreeted(true), SPLASH_HOLD_MS);
    const limit = setTimeout(() => setWaited(true), SPLASH_LIMIT_MS);
    return () => {
      clearTimeout(hold);
      clearTimeout(limit);
    };
  }, []);

  useEffect(() => {
    const webApp = getWebApp();
    webApp?.ready();
    webApp?.expand();
    tolerate(() => webApp?.disableVerticalSwipes?.());
    // Шапка Telegram над приложением — потерянная полоса экрана, а
    // форма обмена и без того помещается впритык.
    tolerate(() => webApp?.requestFullscreen?.());

    void (async () => {
      try {
        const session = await post<{ client: ClientView }>('/api/session');
        setClient(session.client);
      } catch (failure) {
        setError(failure instanceof ApiError ? failure.message : 'Не удалось открыть сервис');
      }
    })();
  }, []);

  /** Завести раздел в ряду, если его там ещё нет. */
  const mount = useCallback((one: Tab) => {
    setMounted((were) => (were.includes(one) ? were : [...were, one]));
  }, []);

  /*
   * Соседи заводятся сами, когда поток освободится.
   *
   * Ждать первого касания незачем: раздела три, данные у каждого свои и
   * небольшие, а единственное, что стоит между нажатием и готовым
   * экраном, — круг до сервера. Сделанный заранее и в простое, он не
   * виден вовсе; сделанный по нажатию — виден весь.
   *
   * Именно в простое, а не сразу за сессией: до первого экрана эти
   * запросы соревновались бы с его собственными за ту же узкую сеть, и
   * ускорив переход, замедлили бы открытие. Где простоя не дождаться,
   * браузер обязан позвать по сроку — иначе на занятом устройстве
   * соседи не завелись бы никогда.
   */
  useEffect(() => {
    if (!client) return;
    const idle = window.requestIdleCallback;
    if (!idle) {
      const timer = setTimeout(() => setMounted(TABS.map((one) => one.id)), IDLE_FALLBACK_MS);
      return () => clearTimeout(timer);
    }
    const handle = idle(() => setMounted(TABS.map((one) => one.id)), { timeout: IDLE_DEADLINE_MS });
    return () => window.cancelIdleCallback?.(handle);
  }, [client]);

  const go = useCallback(
    (next: Tab) => {
      if (next === tab) return;
      mount(next);
      // Возвращение считается только для того, кто в ряду уже стоял:
      // тому, кто заводится сейчас, читать заново нечего — он и так
      // прочтёт при сборке.
      setVisits((were) =>
        mounted.includes(next) ? { ...were, [next]: were[next] + 1 } : were,
      );
      setTab(next);
    },
    [tab, mounted, mount],
  );

  /*
   * Свежее, что нужно жесту, — за одной ссылкой.
   *
   * Слушатели вешаются один раз на всё время жизни ряда. Опиши мы им
   * зависимости честным списком, монтирование соседа сменило бы их
   * посреди касания: старые слушатели снялись бы, новые встали бы с
   * чистого листа, и палец, уже ведущий ряд, для приложения перестал бы
   * существовать.
   */
  const latest = useRef({ index, go, mount, reveal: (_?: number) => {} });
  useEffect(() => {
    latest.current = { index, go, mount, reveal };
  });

  /*
   * Ряд ставится на место записью в узел, а не свойством разметки.
   *
   * Положение ряда — тридцать чисел в секунду, пока ведут палец, и
   * держать их состоянием значило бы гонять React по кругу на каждое
   * касание: событий приходит больше, чем кадров успевает нарисоваться,
   * и на каждое пересобиралось бы дерево оболочки. Здесь же меняется
   * одно свойство одного узла — работа для компоновщика, а не для
   * пересчёта разметки.
   *
   * В пикселях, а не в долях ширины: доли приходится приводить к
   * пикселям всё равно, только на каждом кадре и уже внутри браузера.
   */
  /*
   * Ширина кадра запомнена, а не спрошена.
   *
   * Спросить её у узла — значит заставить браузер пересчитать разметку
   * прямо сейчас, до отрисовки. В кадре анимации такой вопрос стоит
   * ровно того, ради чего вся эта возня: кадр перестаёт успевать. Меняет
   * же она значение дважды за всё время — на повороте экрана и на
   * появлении клавиатуры.
   */
  const width = useRef(0);

  const settle = useCallback((offset = 0) => {
    const node = track.current;
    if (!node) return;
    node.style.transform = `translate3d(${-latest.current.index * width.current + offset}px, 0, 0)`;
  }, []);

  /*
   * Рисуется только то, что видно или вот-вот поедет в кадр.
   *
   * Ряд шире кадра втрое, и обещанный слой у него такого же размера:
   * три полных экрана с их тенями и подложками лежат в видеопамяти
   * разом. Устройству посильнее это ничего не стоит, слабому — стоит
   * плавности: памяти под слой не хватает, и оно перерисовывает его
   * кусками прямо посреди движения.
   *
   * Спрятанное скрыто, а не убрано: разметка у него уже посчитана, и
   * вернуть его в кадр — работа на один кадр, а не на пересчёт всего
   * раздела в тот самый момент, когда за него взялись пальцем.
   */
  const reveal = useCallback((also?: number) => {
    const node = track.current;
    if (!node) return;
    for (const [at, slot] of [...node.children].entries()) {
      (slot as HTMLElement).style.visibility =
        at === latest.current.index || at === also ? '' : 'hidden';
    }
  }, []);

  /** Откуда ряд едет: пока едет, видно и то, что уезжает. */
  const from = useRef(0);

  // Ряд встаёт против выбранного раздела — и когда его сменили кнопкой,
  // и когда окно поменяло ширину: положение считано в пикселях, и после
  // поворота экрана оно указывало бы в пустоту.
  useEffect(() => {
    const measure = () => {
      width.current = viewport.current?.clientWidth ?? 0;
      settle();
    };
    // Уезжающий раздел виден, пока едет: спрятать его вместе с
    // перестановкой значило бы погасить половину кадра на ходу.
    reveal(from.current);
    measure();
    from.current = index;
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [settle, reveal, index, shown]);

  // Доводка кончилась — уехавшее больше не рисуем.
  useEffect(() => {
    const node = track.current;
    if (!node || !shown) return;
    const done = (event: TransitionEvent) => {
      if (event.target === node && event.propertyName === 'transform') reveal();
    };
    node.addEventListener('transitionend', done);
    return () => node.removeEventListener('transitionend', done);
  }, [reveal, shown]);

  /*
   * Перенос пальцем.
   *
   * Обработчики вешаются руками, а не свойствами разметки: остановить
   * прокрутку у переноса можно только слушателем, объявленным
   * неуступчивым, а React вешает свои по-другому.
   */
  useEffect(() => {
    const frame = viewport.current;
    const node = track.current;
    if (!frame || !node || !shown) return;

    let startX = 0;
    let startY = 0;
    /** Куда ведут палец. Пока не решено — жест ничей. */
    let axis: 'x' | 'y' | undefined;
    let offset = 0;
    let tracking = false;
    /** Заказанный кадр. Пальцу отвечаем раз в кадр, а не раз в событие. */
    let frameRequest = 0;

    const paint = () => {
      frameRequest = 0;
      settle(offset);
    };

    const start = (event: TouchEvent) => {
      const touch = event.touches[0];
      // Двумя пальцами разделы не листают: это либо масштабирование,
      // либо случайное касание второй рукой.
      if (event.touches.length !== 1 || !touch) return;
      if (touch.clientX < EDGE_GUARD_PX) return;
      startX = touch.clientX;
      startY = touch.clientY;
      axis = undefined;
      offset = 0;
      tracking = true;
      // Единственный раз за жест, когда разметку спрашивают: касание
      // пришло на свободный поток, до всякой отрисовки.
      width.current = frame.clientWidth;
      // Пока ведут палец, ряд не догоняет доводкой — он под пальцем.
      node.dataset.dragging = '';
    };

    const move = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!tracking || !touch) return;

      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;

      const neighbour = (towards: number) => TABS[latest.current.index + towards];

      if (!axis) {
        if (Math.abs(dx) < AXIS_LOCK_PX && Math.abs(dy) < AXIS_LOCK_PX) return;
        axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
        // Сосед заводится сразу, как стало ясно направление: у него
        // есть весь перенос на то, чтобы прочитать своё, и в кадр он
        // въезжает уже с содержимым.
        const toward = neighbour(dx < 0 ? 1 : -1);
        if (axis === 'x' && toward) {
          latest.current.mount(toward.id);
          // Сосед начинает рисоваться здесь же: в кадр он въедет через
          // считаные миллисекунды, и ждать этого, чтобы его показать,
          // значит показать пустоту.
          latest.current.reveal(latest.current.index + (dx < 0 ? 1 : -1));
        }
      }

      if (axis !== 'x') return;
      // Иначе вместе с переносом поедет и прокрутка внутри раздела.
      if (event.cancelable) event.preventDefault();

      offset = neighbour(dx < 0 ? 1 : -1) ? dx : dx / OVERSCROLL_DAMPING;
      if (!frameRequest) frameRequest = requestAnimationFrame(paint);
    };

    const end = () => {
      if (!tracking) return;
      if (frameRequest) cancelAnimationFrame(frameRequest);
      frameRequest = 0;

      const toward = TABS[latest.current.index + (offset < 0 ? 1 : -1)];
      const commit =
        axis === 'x' && toward && Math.abs(offset) > (width.current || 1) * COMMIT_RATIO;
      // Ряд стоит там же, где стоял: доводке нечего доводить, и о её
      // конце никто не сообщит — соседа гасим сами.
      const motionless = !commit && Math.abs(offset) < 1;

      tracking = false;
      axis = undefined;
      offset = 0;
      // Доводку включаем до того, как назначить ряду место: снятое
      // следом за переносом свойство не успело бы её застать, и ряд
      // прыгнул бы к соседу без движения.
      delete node.dataset.dragging;

      // Дошли — место назначит перестановка раздела; не дошли — ряд
      // возвращается туда, где стоял.
      if (commit) latest.current.go(toward.id);
      else settle();
      if (motionless) latest.current.reveal();
    };

    frame.addEventListener('touchstart', start, { passive: true });
    frame.addEventListener('touchmove', move, { passive: false });
    frame.addEventListener('touchend', end);
    frame.addEventListener('touchcancel', end);
    return () => {
      if (frameRequest) cancelAnimationFrame(frameRequest);
      frame.removeEventListener('touchstart', start);
      frame.removeEventListener('touchmove', move);
      frame.removeEventListener('touchend', end);
      frame.removeEventListener('touchcancel', end);
    };
  }, [shown, settle]);

  /*
   * Разделы собираются здесь и не пересобираются на каждый пиксель
   * переноса. Ряд под пальцем двигает оболочку по многу раз в секунду, и
   * без этого вместе с ней перерисовывались бы все три раздела разом —
   * ровно в тот момент, когда от приложения ждут плавности.
   */
  const screens = useMemo<Readonly<Record<Tab, ReactNode>>>(
    () => ({
      exchange: (
        <ExchangeScreen
          revisit={visits.exchange}
          onReady={() => setScreenReady(true)}
        />
      ),
      bonus: client ? (
        <BonusSection
          revisit={visits.bonus}
          consent={client.marketingConsent}
          onConsentChanged={(marketingConsent) => setClient({ ...client, marketingConsent })}
        />
      ) : undefined,
      card: <CardSection revisit={visits.card} />,
    }),
    [client, visits],
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

      {error || stalled ? (
        <div className="app__center">
          <p className="error">
            {error ?? 'Сервис не отвечает. Закройте приложение и откройте снова.'}
          </p>
        </div>
      ) : !client ? undefined : (
        <div
          className="frame"
          ref={viewport}
          /*
            Пока сверху заставка, кадра под ней для клиента нет. Она
            закрывает его собой, но собой же и только: не сказав этого,
            мы оставили бы под ней живой экран — с фокусом, который
            уходит в невидимые кнопки, и с диктором, который читает
            заслонённое приветствием.
          */
          inert={!greetingOver}
        >
          {/*
            Ни положения, ни признака переноса в разметке нет: и то и
            другое меняется по многу раз в секунду и живёт записью в
            узел. Отдай их React — и каждое касание пальца стоило бы
            прохода по дереву оболочки.
          */}
          <div className="track" ref={track}>
            {TABS.map(({ id }) => (
              <div
                key={id}
                className={keyboard ? 'track__slot track__slot--bare' : 'track__slot'}
                // Соседний раздел стоит рядом и остаётся деревом
                // страницы: без этого диктор читал бы все три подряд, а
                // клавиша перехода уводила бы фокус за край кадра.
                inert={id !== tab}
              >
                {mounted.includes(id) ? screens[id] : undefined}
              </div>
            ))}
          </div>
        </div>
      )}

      {/*
        Заставка лежит поверх, а не вместо: под ней уже стоит первый
        экран и спрашивает своё. Уходит она, когда сошлись оба условия —
        отстоян срок и экрану есть что показать; иначе приветствие
        оканчивалось бы строкой «загружаем», то есть ровно тем, от чего
        оно и прикрывает.
      */}
      {greetingOver ? undefined : <Splash />}

      {/*
        Под открытой клавиатурой панель садится ей на крышку и закрывает
        то самое поле, ради которого клавиатуру и вызвали. Переключать
        разделы посреди ввода суммы всё равно незачем.

        Под заставкой её нет по другой причине: разделы в этот момент не
        показываются, и нажатие ничего бы не сделало. Панель поверх
        приветствия обещала бы переход, которого не будет.
      */}
      {keyboard || !greetingOver || !client ? undefined : (
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
      )}

      {/*
        Вопрос висит, пока клиент на него не ответил, и поверх любого
        раздела: закрывший приложение до ответа иначе не увидел бы его
        больше никогда. Но не поверх приветствия: спрошенное раньше, чем
        клиент увидел, куда попал, — вопрос от неизвестно кого.
      */}
      {greetingOver && client && !client.marketingConsentAsked ? (
        <MarketingConsentAsk
          onAnswered={(marketingConsent) =>
            setClient({ ...client, marketingConsent, marketingConsentAsked: true })
          }
        />
      ) : undefined}
    </div>
  );
}
