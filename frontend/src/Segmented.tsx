// A segmented control as an ARIA radio group: one Tab stop (the chosen item),
// arrows move the choice and focus round the row, Home/End jump to the ends.
// Styled by `index.css`'s `.seg` rules.
import { useRef } from 'react';
import { segmentedIndex } from './keyboard';

export interface SegmentedOption<T> {
  value: T;
  label: string;
  title?: string;
}

interface SegmentedProps<T> {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** The group's accessible name, e.g. "Colour the map by". */
  label: string;
  /** Extra classes beside `seg`, e.g. `seg-sm`. */
  className?: string;
}

export function Segmented<T>({ options, value, onChange, label, className }: SegmentedProps<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const chosen = options.findIndex((o) => o.value === value);
  // With nothing chosen, the first item keeps the group reachable by Tab.
  const tabStop = chosen >= 0 ? chosen : 0;

  const onKeyDown = (e: React.KeyboardEvent, index: number) => {
    const next = segmentedIndex(e.key, index, options.length);
    if (next == null) return;
    e.preventDefault();
    onChange(options[next].value);
    refs.current[next]?.focus();
  };

  return (
    <div
      className={className ? `seg ${className}` : 'seg'}
      role="radiogroup"
      aria-label={label}
    >
      {options.map((o, i) => (
        <button
          key={o.label}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          role="radio"
          aria-checked={i === chosen}
          tabIndex={i === tabStop ? 0 : -1}
          className={i === chosen ? 'seg-on' : ''}
          title={o.title}
          onClick={() => onChange(o.value)}
          onKeyDown={(e) => onKeyDown(e, i)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
