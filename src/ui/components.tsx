import { useEffect, useState, type ReactNode } from 'react';

export function Card({ title, subtitle, children, actions, className = '' }: { title?: ReactNode; subtitle?: ReactNode; children: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <header className="card-head">
          <div>
            {title && <h3>{title}</h3>}
            {subtitle && <p className="muted small">{subtitle}</p>}
          </div>
          {actions && <div className="card-actions">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function Kpi({ label, value, sub, tone, icon }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'good' | 'bad' | 'warn' | 'solar' | 'gpu' | 'farm' | 'homes' | 'battery'; icon?: string }) {
  return (
    <div className={`kpi ${tone ? `kpi-${tone}` : ''}`}>
      <div className="kpi-label">{icon && <span className="kpi-icon" aria-hidden>{icon}</span>}{label}</div>
      <div className="kpi-value">{value}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </div>
  );
}

export function Grid({ children, cols = 3, className = '' }: { children: ReactNode; cols?: number; className?: string }) {
  return <div className={`grid grid-${cols} ${className}`}>{children}</div>;
}

/** Slider + number box. Commits on every change; the number box tolerates partial input. */
export function Field({ label, value, onChange, min, max, step = 1, unit, hint, disabled }: { label: ReactNode; value: number; onChange: (v: number) => void; min: number; max: number; step?: number; unit?: string; hint?: ReactNode; disabled?: boolean }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = (raw: string) => {
    const v = Number(raw);
    if (raw.trim() !== '' && Number.isFinite(v)) onChange(v);
  };
  const decimals = step < 1 ? Math.min(4, String(step).split('.')[1]?.length ?? 2) : 0;
  return (
    <label className={`field ${disabled ? 'disabled' : ''}`}>
      <span className="field-label">
        {label}
        <span className="field-value">
          <input type="number" value={text} step={step} min={min} max={max} disabled={disabled}
            onChange={(e) => { setText(e.target.value); commit(e.target.value); }} onBlur={() => setText(String(value))} aria-label={typeof label === 'string' ? label : undefined} />
          {unit && <span className="unit">{unit}</span>}
        </span>
      </span>
      <input type="range" min={min} max={max} step={step} value={Math.min(max, Math.max(min, value))} disabled={disabled}
        onChange={(e) => onChange(Number(Number(e.target.value).toFixed(decimals)))} aria-label={typeof label === 'string' ? `${label} slider` : undefined} />
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export function Select<T extends string>({ label, value, options, onChange, hint }: { label: ReactNode; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; hint?: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export function Toggle({ label, checked, onChange, hint }: { label: ReactNode; checked: boolean; onChange: (v: boolean) => void; hint?: ReactNode }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle-track" aria-hidden><span className="toggle-thumb" /></span>
      <span>
        <span className="toggle-label">{label}</span>
        {hint && <span className="field-hint">{hint}</span>}
      </span>
    </label>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string; title?: string }[]; onChange: (v: T) => void; label?: string }) {
  return (
    <div className="segmented-wrap">
      {label && <span className="field-label">{label}</span>}
      <div className="segmented" role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button key={o.value} type="button" role="radio" aria-checked={o.value === value} title={o.title}
            className={o.value === value ? 'active' : ''} onClick={() => onChange(o.value)}>{o.label}</button>
        ))}
      </div>
    </div>
  );
}

export function Note({ tone = 'info', children }: { tone?: 'info' | 'warn' | 'good' | 'bad'; children: ReactNode }) {
  return <div className={`note note-${tone}`}>{children}</div>;
}

export function Ext({ href, children }: { href: string; children: ReactNode }) {
  return <a href={href} target="_blank" rel="noreferrer noopener">{children}</a>;
}

export function Progress({ value, label }: { value: number; label?: string }) {
  return (
    <div className="progress" role="progressbar" aria-valuenow={Math.round(value * 100)} aria-valuemin={0} aria-valuemax={100}>
      <div className="progress-bar" style={{ width: `${Math.round(Math.min(1, value) * 100)}%` }} />
      {label && <span className="progress-label">{label}</span>}
    </div>
  );
}

export function Pill({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'good' | 'bad' | 'warn' | 'info' }) {
  return <span className={`pill pill-${tone}`}>{children}</span>;
}
