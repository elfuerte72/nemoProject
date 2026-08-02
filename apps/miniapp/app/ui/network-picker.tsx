'use client';

/**
 * Выбор сети перевода.
 *
 * Один на две формы — реквизиты обмена и заявку на вывод: сеть в них
 * спрашивается об одном и том же, и разойтись эти два места не должны.
 *
 * Сеть спрашивается до адреса и остаётся видна рядом с ним: адрес в
 * разных сетях выглядит одинаково, а перевод не в ту не возвращается.
 *
 * Пустой справочник — рабочее состояние, а не поломка формы: сеть гасит
 * администратор, когда кошелёк в ней недоступен, и сказать об этом нужно
 * словами, а не пустым рядом кнопок.
 */
export function NetworkPicker({
  networks,
  selected,
  empty,
  onPick,
}: {
  readonly networks: readonly string[];
  readonly selected: string;
  /** Что сказать, когда сетей нет: продолжения у форм разные. */
  readonly empty: string;
  readonly onPick: (network: string) => void;
}) {
  return (
    <div className="field">
      <span className="field__label">Сеть</span>
      {networks.length === 0 ? (
        <p className="hint">{empty}</p>
      ) : (
        <div className="chips">
          {networks.map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => onPick(value)}
              aria-pressed={selected === value}
              className="chips__item"
            >
              {value}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Подпись к полю адреса: сеть в ней видна, пока она выбрана. */
export function addressLabel(network: string): string {
  return network ? `Адрес кошелька в сети ${network}` : 'Адрес кошелька';
}
