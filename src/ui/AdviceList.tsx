import type { Finding } from '../rules/types';

const SEVERITY_ICON: Record<Finding['severity'], string> = { error: '⛔', warn: '⚠️', info: 'ℹ️' };

export function AdviceList({ findings }: { findings: Finding[] }) {
  if (findings.length === 0) {
    return <p className="advice-empty">Ошибок не найдено — хорошая подача!</p>;
  }
  return (
    <ul className="advice-list">
      {findings.map((f, i) => (
        <li key={i} className={`advice advice--${f.severity}`}>
          <strong>{SEVERITY_ICON[f.severity]} {f.ruleId}</strong>
          <p>
            {f.confidence === 'low' && <span className="advice-hedge">Возможно: </span>}
            {f.advice}
          </p>
        </li>
      ))}
    </ul>
  );
}
