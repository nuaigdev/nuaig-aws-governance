/**
 * Formatters for the data values rendered in the mono face.
 *
 * Centralised so a file size or a timestamp reads identically on every screen —
 * the sans/mono split only does its job if the mono side is consistent.
 */

const KIB = 1024;
const UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

/**
 * Human file size, binary-based (what S3 and every file manager report).
 *
 * Fixed to one decimal above KB so column widths stay stable in a dense table.
 */
export function formatBytes(bytes: number | undefined | null): string {
  if (bytes === undefined || bytes === null || Number.isNaN(bytes)) return "—";
  if (bytes < 0) return "—";
  if (bytes === 0) return "0 B";

  let value = bytes;
  let unit = 0;
  while (value >= KIB && unit < UNITS.length - 1) {
    value /= KIB;
    unit += 1;
  }

  return unit === 0
    ? `${Math.round(value)} ${UNITS[unit]}`
    : `${value.toFixed(1)} ${UNITS[unit]}`;
}

/**
 * Absolute timestamp, in the viewer's locale and timezone.
 *
 * Absolute rather than relative ("3 days ago") on purpose: this is an audit and
 * file-management tool, where the exact moment is the point. Relative time is
 * offered separately by `formatRelative` for secondary context.
 */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";

  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

/** Date only, for grouping and filters. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
  }).format(date);
}

/** Coarse relative time. Secondary context only — never the sole timestamp. */
export function formatRelative(
  iso: string | null | undefined,
  now: Date = new Date(),
): string {
  if (!iso) return "Never";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";

  const seconds = Math.round((date.getTime() - now.getTime()) / 1000);
  const abs = Math.abs(seconds);

  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

  if (abs < 60) return formatter.format(Math.round(seconds), "second");
  if (abs < 3600) return formatter.format(Math.round(seconds / 60), "minute");
  if (abs < 86400) return formatter.format(Math.round(seconds / 3600), "hour");
  if (abs < 2592000) return formatter.format(Math.round(seconds / 86400), "day");
  if (abs < 31536000) return formatter.format(Math.round(seconds / 2592000), "month");
  return formatter.format(Math.round(seconds / 31536000), "year");
}

/**
 * The display name of an S3 key: the part after the last `/`.
 *
 * A trailing slash means a folder prefix, whose name is the last segment.
 */
export function keyBasename(key: string): string {
  const trimmed = key.endsWith("/") ? key.slice(0, -1) : key;
  const index = trimmed.lastIndexOf("/");
  return index === -1 ? trimmed : trimmed.slice(index + 1);
}

/** The prefix (folder path) of an S3 key, including its trailing slash. */
export function keyPrefix(key: string): string {
  const index = key.lastIndexOf("/");
  return index === -1 ? "" : key.slice(0, index + 1);
}

/** Uppercase file extension, or `null` when there is none. */
export function fileExtension(key: string): string | null {
  const name = keyBasename(key);
  const index = name.lastIndexOf(".");
  if (index <= 0 || index === name.length - 1) return null;
  return name.slice(index + 1).toUpperCase();
}

/** Pluralises a count with its noun, e.g. `3 files`, `1 file`. */
export function pluralise(count: number, singular: string, plural?: string): string {
  return `${count} ${count === 1 ? singular : (plural ?? `${singular}s`)}`;
}
