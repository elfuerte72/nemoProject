import { HowTo } from '@nemo/ui';
import { supportUsername, viewer } from '@/lib/reads';
import { DisabledBanner } from '@/app/ui/disabled-banner';
import { SupportLink } from '@/app/ui/support-link';

export const dynamic = 'force-dynamic';

/**
 * Поддержка: ссылка на человека в Telegram.
 *
 * Переписки внутри кабинета нет намеренно: заводить её ради нескольких
 * вопросов в неделю значит заводить второй непрочитанный ящик. Вопросы
 * мерчанта идут туда же, куда идут вопросы о договоре, — к человеку, с
 * которым он о работе и договаривался.
 */

const HOW_TO = [
  {
    title: 'С чем сюда идти',
    detail:
      'Заявка застряла, деньги ушли не туда, нужно поменять анкету, вопрос о курсе или ' +
      'об условиях. Номер заявки и свой номер сделки — сразу в первом сообщении: с ними ' +
      'ответят быстрее.',
  },
  {
    title: 'Чего здесь не решают',
    detail:
      'Курс заявки не пересчитывают: он назван при подаче и держится до конца срока ' +
      'оплаты. Отменить взятую в работу заявку может менеджер — об этом как раз сюда.',
  },
];

export default async function SupportPage() {
  const { session } = await viewer();
  const support = await supportUsername();

  return (
    <main className="page page--narrow">
      <DisabledBanner status={session.status} />

      <header className="page__head">
        <div>
          <h1 className="page__title">Поддержка</h1>
          <p className="page__sub">Вопросы — человеку, в Telegram.</p>
        </div>
      </header>

      <HowTo title="Как это устроено" sub="С чем идти в поддержку" items={HOW_TO} />

      <section className="card">
        <h2 className="card__title">Написать</h2>
        <p className="card__note">
          Отвечает человек, а не бот. Рабочее время — по договорённости; ночью ответ придёт
          утром.
        </p>
        <SupportLink username={support} className="btn btn--gold" />
      </section>
    </main>
  );
}
