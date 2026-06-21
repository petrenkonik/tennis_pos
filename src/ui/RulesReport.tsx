import type { RuleResult, RuleStatus } from '../rules/types';
import type { Phases } from '../types';

const STATUS: Record<RuleStatus, { icon: string; label: string }> = {
  ok: { icon: '✅', label: 'норма' },
  warn: { icon: '⚠️', label: 'на грани' },
  error: { icon: '⛔', label: 'ошибка' },
  unknown: { icon: '❔', label: 'не определено' },
};

const PHASE_RU: Record<keyof Phases['phases'], string> = {
  preparation: 'Подготовка',
  trophy: 'Трофей',
  acceleration: 'Разгон',
  followThrough: 'Завершение',
};

function range(r?: [number, number], unit = ''): string {
  return r ? `${r[0]}–${r[1]}${unit}` : '—';
}

export function RulesReport(
  { results, onSeek }: { results: RuleResult[]; onSeek?: (timestampMs: number) => void },
) {
  return (
    <table className="rules-report">
      <thead>
        <tr>
          <th>Правило</th><th>Фаза</th><th>Статус</th>
          <th>Значение</th><th>Норма</th><th>Уверенность</th><th>Момент</th>
        </tr>
      </thead>
      <tbody>
        {results.map((r) => {
          const s = STATUS[r.status];
          const ms = r.atTimestampMs;
          return (
            <tr key={r.ruleId} className={`rule-row rule-row--${r.status}`}>
              <td>{r.ruleId} · {r.title}</td>
              <td>{PHASE_RU[r.phase]}</td>
              <td>{s.icon} {s.label}</td>
              <td>{r.metric ? `${r.metric.value}${r.metric.unit}` : '—'}</td>
              <td>{r.metric ? range(r.metric.referenceRange, r.metric.unit) : '—'}</td>
              <td>{r.confidence}</td>
              <td>
                {ms !== undefined ? (
                  <button type="button" className="seek-btn" onClick={() => onSeek?.(ms)}>
                    ▶ {(ms / 1000).toFixed(1)}с
                  </button>
                ) : '—'}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
