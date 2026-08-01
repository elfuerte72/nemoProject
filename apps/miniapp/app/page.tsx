import { ExchangeScreen } from './exchange-screen';

/**
 * Основной экран клиента.
 *
 * Форма экрана от блокера C1 не зависит: направления берутся из
 * справочника, а не перечисляются в разметке. Пустой справочник — это
 * состояние экрана, а не повод его не писать.
 */
export default function HomePage() {
  return <ExchangeScreen />;
}
