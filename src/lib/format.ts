import { activeClient } from "@config/index";

/**
 * Formatters for the data values rendered in the mono face.
 *
 * Centralised so a file size or a timestamp reads identically on every screen —
 * the sans/mono split only does its job if the mono side is consistent.
 *
 * ## Timestamps are rendered in the client's timezone, not the viewer's
 *
 * Every absolute time here is formatted in `activeClient.timeZone`. The zone is
 * a parameter with that default so these stay testable, but nothing should pass
 * it in normal use.
 *
 * This used to omit `timeZone` entirely, which meant the browser's. The same
 * audit record then read as 02:59 in Pennsylvania and 12:29 in India with no
 * label either way — fine until two people compare notes on one incident. The
 * stored value is UTC regardless; this is purely how it is shown, and the zone
 * is stated on screen wherever these appear.
 *
 * The locale is pinned to `en-US` for the same reason the zone is pinned: so
 * every viewer reads the identical string. It also keeps the zone legible —
 * `en-GB` renders `America/New_York` as "GMT-4" where `en-US` gives "EDT".
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
 * Absolute timestamp, in the client's timezone.
 *
 * Absolute rather than relative ("3 days ago") on purpose: this is an audit and
 * file-management tool, where the exact moment is the point. Relative time is
 * offered separately by `formatRelative` for secondary context.
 *
 * The zone is deliberately *not* appended here — these fill dense table
 * columns, and repeating "EDT" on every row is noise. The screen states it
 * once; `formatDateTimeWithZone` is for tooltips and anywhere a timestamp
 * appears alone.
 */
export function formatDateTime(
  iso: string | null | undefined,
  timeZone: string = activeClient.timeZone,
): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";

  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone,
  }).format(date);
}

/**
 * The same instant with its seconds and zone, for a tooltip or a detail line.
 *
 * Seconds are included because two audit events a few seconds apart otherwise
 * render identically, which looks like a duplicated record.
 */
export function formatDateTimeWithZone(
  iso: string | null | undefined,
  timeZone: string = activeClient.timeZone,
): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";

  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone,
    timeZoneName: "short",
  }).format(date);
}

/**
 * How to name the display zone on screen, e.g. "Eastern Daylight Time (EDT)".
 *
 * Resolved against a date rather than stated in config because the answer
 * changes twice a year — "EST" would be wrong for half of it.
 */
export function timeZoneLabel(
  timeZone: string = activeClient.timeZone,
  on: Date = new Date(),
): string {
  const name = (style: "long" | "short") =>
    new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: style })
      .formatToParts(on)
      .find((part) => part.type === "timeZoneName")?.value ?? timeZone;

  const long = name("long");
  const short = name("short");
  return long === short ? long : `${long} (${short})`;
}

/** Date only, for grouping and filters. */
export function formatDate(
  iso: string | null | undefined,
  timeZone: string = activeClient.timeZone,
): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    timeZone,
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
