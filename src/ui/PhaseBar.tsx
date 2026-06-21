import type { Phases } from '../types';

const LABELS: Array<[keyof Phases['phases'], string]> = [
  ['preparation', 'Подготовка'],
  ['trophy', 'Трофей'],
  ['acceleration', 'Разгон'],
  ['followThrough', 'Завершение'],
];

export function PhaseBar({ phases }: { phases: Phases }) {
  const last = phases.phases.followThrough[1] || 1;
  return (
    <div className="phase-bar">
      {LABELS.map(([key, label]) => {
        const [start, end] = phases.phases[key];
        const width = `${Math.max(0, ((end - start) / last) * 100)}%`;
        return (
          <div key={key} className={`phase-seg phase-seg--${key}`} style={{ width }}>
            <span>{label}</span>
          </div>
        );
      })}
    </div>
  );
}
