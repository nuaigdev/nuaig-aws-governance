/**
 * Key naming rules for uploads.
 *
 * Pure functions, separated from the S3 calls so the collision logic — the part
 * that enforces "uploads must never overwrite an existing key" — can be tested
 * directly.
 */

/** Splits a key into its stem and extension, keeping compound extensions intact. */
export function splitExtension(key: string): { stem: string; extension: string } {
  const slash = key.lastIndexOf("/");
  const name = slash === -1 ? key : key.slice(slash + 1);
  const dir = slash === -1 ? "" : key.slice(0, slash + 1);

  // `.tar.gz` and friends: treat the compound as one extension so a
  // deduplicated name reads `archive (2).tar.gz`, not `archive.tar (2).gz`.
  const compound = /\.(tar)\.(gz|bz2|xz|zst)$/i.exec(name);
  if (compound) {
    return {
      stem: dir + name.slice(0, compound.index),
      extension: name.slice(compound.index),
    };
  }

  const dot = name.lastIndexOf(".");
  // A leading dot is a dotfile, not an extension.
  if (dot <= 0) return { stem: key, extension: "" };

  return { stem: dir + name.slice(0, dot), extension: name.slice(dot) };
}

/**
 * Finds a key that does not collide with anything already present.
 *
 * Appends ` (2)`, ` (3)` … before the extension, matching what desktop file
 * managers do, so the result is immediately recognisable to a user.
 *
 * `exists` is called with each candidate and must report whether an object with
 * that key is already in the bucket.
 *
 * ## The race this does not close
 *
 * Between the final check and the upload, another client could write the same
 * key. S3 has no native "put if absent" for this path, so the guarantee is
 * completed by bucket versioning (enabled in `backend.ts`): if a collision does
 * slip through, the earlier object survives as a previous version rather than
 * being destroyed. Nothing in this app can delete either version.
 */
export async function nextAvailableKey(
  desiredKey: string,
  exists: (key: string) => Promise<boolean>,
  maxAttempts = 100,
): Promise<string> {
  if (!(await exists(desiredKey))) return desiredKey;

  const { stem, extension } = splitExtension(desiredKey);

  for (let counter = 2; counter <= maxAttempts; counter += 1) {
    const candidate = `${stem} (${counter})${extension}`;
    if (!(await exists(candidate))) return candidate;
  }

  throw new Error(
    `Could not find an unused name for "${desiredKey}" after ${maxAttempts} attempts.`,
  );
}

/**
 * Removes C0 control characters and DEL.
 *
 * These break the XML in S3's listing responses, so an object created with one
 * in its key can become hard to enumerate afterwards.
 *
 * Written as a code-point filter rather than a regex character class on
 * purpose: the equivalent class has to contain literal control characters,
 * which are invisible in an editor and survive copy-paste and tooling badly.
 */
function stripControlCharacters(value: string): string {
  return [...value]
    .filter((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code > 0x1f && code !== 0x7f;
    })
    .join("");
}

/**
 * Rejects keys that would escape their prefix or confuse S3 listing.
 *
 * Browsers hand us the file's own name, which on some systems can contain path
 * separators or traversal segments.
 */
export function sanitiseFileName(fileName: string): string {
  const withoutPath = fileName.split(/[/\\]/).pop() ?? fileName;
  const cleaned = stripControlCharacters(withoutPath)
    .replace(/^\.+/, "")
    .trim();

  return cleaned === "" ? "unnamed-file" : cleaned;
}

/** Joins a folder prefix and a file name into a full object key. */
export function joinKey(prefix: string, fileName: string): string {
  const normalisedPrefix =
    prefix === "" || prefix.endsWith("/") ? prefix : `${prefix}/`;
  return `${normalisedPrefix}${fileName}`;
}
