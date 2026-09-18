import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
} from "react";

import styles from "./ui.module.css";

/* ------------------------------------------------------------------ Button */

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  small?: boolean;
  block?: boolean;
  /** Shows a spinner and disables the button. */
  busy?: boolean;
}

export function Button({
  variant = "secondary",
  small,
  block,
  busy,
  disabled,
  children,
  className,
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={[
        styles.button,
        styles[variant],
        small ? styles.small : "",
        block ? styles.block : "",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      {...rest}
    >
      {busy && <span className={styles.spinner} aria-hidden="true" />}
      {children}
    </button>
  );
}

/* -------------------------------------------------------------------- Card */

export function Card({
  title,
  description,
  actions,
  flush,
  children,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  /** Removes body padding — use when the card contains a table. */
  flush?: boolean;
  children?: ReactNode;
}) {
  return (
    <section className={styles.card}>
      {(title || actions) && (
        <header className={styles.cardHeader}>
          <div className={styles.cardHeaderText}>
            {title && <h2 className={styles.cardTitle}>{title}</h2>}
            {description && <p className={styles.cardDescription}>{description}</p>}
          </div>
          {actions}
        </header>
      )}
      {children != null && (
        <div className={flush ? styles.cardBodyFlush : styles.cardBody}>
          {children}
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------- Field */

interface FieldProps {
  label: string;
  htmlFor: string;
  hint?: ReactNode;
  error?: string | null;
  children: ReactNode;
}

export function Field({ label, htmlFor, hint, error, children }: FieldProps) {
  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={htmlFor}>
        {label}
      </label>
      {hint && <span className={styles.hint}>{hint}</span>}
      {children}
      {error && (
        <span className={styles.fieldError} role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

interface TextInputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
  /** Renders in the mono face — for codes, keys and other system values. */
  mono?: boolean;
}

export function TextInput({ invalid, mono, className, ...rest }: TextInputProps) {
  return (
    <input
      className={[
        styles.input,
        invalid ? styles.inputInvalid : "",
        mono ? styles.inputMono : "",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
      aria-invalid={invalid || undefined}
      {...rest}
    />
  );
}

export function Select({
  className,
  children,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={[styles.select, className ?? ""].join(" ")} {...rest}>
      {children}
    </select>
  );
}

/* ----------------------------------------------------------------- Message */

export type MessageTone = "error" | "success" | "warning" | "info";

const MESSAGE_STYLES: Record<MessageTone, string> = {
  error: styles.messageError,
  success: styles.messageSuccess,
  warning: styles.messageWarning,
  info: styles.messageInfo,
};

export function Message({
  tone = "info",
  children,
}: {
  tone?: MessageTone;
  children: ReactNode;
}) {
  return (
    <div
      className={`${styles.message} ${MESSAGE_STYLES[tone]}`}
      role={tone === "error" ? "alert" : "status"}
    >
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------- Badge */

export type BadgeTone = "neutral" | "success" | "warning" | "error" | "primary";

const BADGE_STYLES: Record<BadgeTone, string> = {
  neutral: styles.badgeNeutral,
  success: styles.badgeSuccess,
  warning: styles.badgeWarning,
  error: styles.badgeError,
  primary: styles.badgePrimary,
};

export function Badge({
  tone = "neutral",
  children,
}: {
  tone?: BadgeTone;
  children: ReactNode;
}) {
  return <span className={`${styles.badge} ${BADGE_STYLES[tone]}`}>{children}</span>;
}

/* -------------------------------------------------------------- EmptyState */

export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className={styles.empty}>
      <p className={styles.emptyTitle}>{title}</p>
      {children && <p className={styles.emptyBody}>{children}</p>}
      {action && <div className={styles.emptyAction}>{action}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------- Table */

export function TableWrap({ children }: { children: ReactNode }) {
  return <div className={styles.tableWrap}>{children}</div>;
}

export function Table({ children }: { children: ReactNode }) {
  return <table className={styles.table}>{children}</table>;
}

export type SortDirection = "asc" | "desc";

export function SortableHeader<K extends string>({
  columnKey,
  label,
  activeKey,
  direction,
  onSort,
  numeric,
}: {
  columnKey: K;
  label: string;
  activeKey: K;
  direction: SortDirection;
  onSort: (key: K) => void;
  numeric?: boolean;
}) {
  const active = activeKey === columnKey;
  return (
    <th
      scope="col"
      className={numeric ? styles.numeric : undefined}
      aria-sort={active ? (direction === "asc" ? "ascending" : "descending") : "none"}
    >
      <button
        type="button"
        className={styles.sortButton}
        onClick={() => onSort(columnKey)}
      >
        {label}
        {active && (
          <span className={styles.sortIndicator} aria-hidden="true">
            {direction === "asc" ? "▲" : "▼"}
          </span>
        )}
      </button>
    </th>
  );
}

export { styles as uiStyles };
