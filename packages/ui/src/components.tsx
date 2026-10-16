import { motion } from 'motion/react';
import { type ComponentProps, type ReactNode, useId } from 'react';
import { Icon, type IconName } from './icons.js';
import { spring } from './motion.js';

const cx = (...parts: (string | false | undefined)[]) => parts.filter(Boolean).join(' ');

type ButtonProps = ComponentProps<'button'> & {
  variant?: 'default' | 'primary' | 'quiet' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  icon?: IconName;
  busy?: boolean;
};

export function Button({ variant = 'default', size = 'md', icon, busy, children, className, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      className={cx(
        'l-btn',
        variant !== 'default' && `l-btn--${variant}`,
        size !== 'md' && `l-btn--${size}`,
        className,
      )}
      aria-busy={busy || undefined}
      {...rest}
    >
      {busy ? (
        <span className="l-spinner" aria-hidden="true" />
      ) : (
        icon && <Icon name={icon} size={size === 'sm' ? 14 : 16} />
      )}
      {children}
    </button>
  );
}

type IconButtonProps = ComponentProps<'button'> & { icon: IconName; label: string; size?: 'sm' | 'md' };

export function IconButton({ icon, label, size = 'md', className, ...rest }: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cx('l-iconbtn', size === 'sm' && 'l-iconbtn--sm', className)}
      {...rest}
    >
      <Icon name={icon} size={size === 'sm' ? 14 : 17} />
    </button>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="l-kbd">{children}</kbd>;
}

export function Chip({
  children,
  tone,
  mono,
}: {
  children: ReactNode;
  tone?: 'accent' | 'ok' | 'warn';
  mono?: boolean;
}) {
  return <span className={cx('l-chip', tone && `l-chip--${tone}`, mono && 'l-chip--mono')}>{children}</span>;
}

export function Badge({ children }: { children: ReactNode }) {
  return <span className="l-badge">{children}</span>;
}

export function Avatar({
  name,
  size = 32,
  presence,
  icon,
}: {
  name: string;
  size?: number;
  presence?: 'on' | 'busy' | 'off';
  icon?: IconName;
}) {
  const initial = name.trim().charAt(0).toLocaleUpperCase() || '·';
  return (
    <span
      className="l-avatar"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }}
      aria-hidden="true"
    >
      {icon ? <Icon name={icon} size={Math.round(size * 0.5)} /> : initial}
      {presence && <span className={cx('l-presence', presence !== 'off' && `l-presence--${presence}`)} />}
    </span>
  );
}

export function LiveDot() {
  return <span className="l-live" aria-hidden="true" />;
}

export function Spinner({ label }: { label?: string }) {
  return label ? (
    <span className="l-spinner" role="status" aria-label={label} />
  ) : (
    <span className="l-spinner" aria-hidden="true" />
  );
}

export function Track({ value, busy }: { value?: number; busy?: boolean }) {
  return (
    <span className={cx('l-track', busy && 'l-track--busy')} aria-hidden="true">
      <span style={busy ? undefined : { width: `${Math.round((value ?? 0) * 100)}%` }} />
    </span>
  );
}

type FieldProps = ComponentProps<'input'> & { label: string; hint?: string; error?: string };

export function TextField({ label, hint, error, id, className, ...rest }: FieldProps) {
  const auto = useId();
  const inputId = id ?? auto;
  return (
    <div className={cx('l-field', className)}>
      <label className="l-field__label" htmlFor={inputId}>
        {label}
      </label>
      <input
        id={inputId}
        className="l-input"
        aria-invalid={error ? true : undefined}
        aria-describedby={hint || error ? `${inputId}-note` : undefined}
        {...rest}
      />
      {(error || hint) && (
        <span id={`${inputId}-note`} className={error ? 'l-field__error' : 'l-field__hint'}>
          {error ?? hint}
        </span>
      )}
    </div>
  );
}

export function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className="l-switch"
      onClick={() => onChange(!checked)}
    />
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  layoutId,
}: {
  value: T;
  options: { value: T; label: string; icon?: IconName }[];
  onChange: (next: T) => void;
  label: string;
  /** Unique per instance, so the moving thumb animates only inside its own control. */
  layoutId: string;
}) {
  return (
    <fieldset className="l-seg">
      <legend className="l-sr">{label}</legend>
      {options.map((o) => (
        <label key={o.value} className="l-seg__opt" data-checked={o.value === value || undefined}>
          <input
            type="radio"
            className="l-sr"
            name={layoutId}
            value={o.value}
            checked={o.value === value}
            onChange={() => onChange(o.value)}
          />
          {o.value === value && <motion.span layoutId={layoutId} className="l-seg__thumb" transition={spring} />}
          <span className="l-seg__label">
            {o.icon && <Icon name={o.icon} size={14} />}
            {o.label}
          </span>
        </label>
      ))}
    </fieldset>
  );
}
