import { clientConfig as acmeSeniorLiving } from "./clients/acme-senior-living";
import { clientConfig as nuaigInternal } from "./clients/nuaig-internal";
import { clientConfig as presbyterianSeniorLiving } from "./clients/presbyterian-senior-living";
import type { ClientConfig } from "./types";
import { validateClientConfig } from "./validate";

/**
 * Every client this codebase can be deployed as.
 *
 * **String literals on purpose — never derive this from the config objects.**
 * Referencing them here is exactly what used to pull every tenant into the
 * browser bundle. It exists for error messages and for the drift test; the
 * resolver below is the only thing that reaches a config.
 */
export const KNOWN_CLIENT_IDS = [
  "nuaig-internal",
  "acme-senior-living",
  "presbyterian-senior-living",
] as const;

/**
 * Resolves the one client this deployment serves.
 *
 * ## Why this is a switch and not a lookup table
 *
 * This was a `Record` keyed by client id, built from every client config. That
 * read better, but it *referenced* all of them, so the bundler had to keep all
 * of them — and a client's browser bundle shipped every other client's display
 * name and physical bucket names. Nothing rendered it, and bucket names are
 * useless without credentials since public access is blocked, but it still
 * meant one client's deployment carrying another client's inventory. That is
 * not something to hand a healthcare client's security reviewer.
 *
 * Next inlines `process.env.NEXT_PUBLIC_CLIENT_ID` as a string literal at build
 * time, so the `switch` below folds to a constant and the non-matching branches
 * become unreachable. Their imports are then unreferenced, and
 * `config/package.json` marks the client modules side-effect-free so the
 * bundler is permitted to drop them. The env var is read directly in the
 * discriminant rather than through a local, so the substitution is textual and
 * no constant-propagation pass has to be relied on.
 *
 * Under `tsx` — where the Amplify backend and the tests load this — there is no
 * inlining and the switch is an ordinary runtime comparison. Same behaviour,
 * same errors.
 *
 * The cost is that adding a client means editing two places in this file.
 * `config/index.test.ts` fails if they drift apart.
 */
function resolveClientConfig(): ClientConfig {
  switch (process.env.NEXT_PUBLIC_CLIENT_ID) {
    case "nuaig-internal":
      return checked(nuaigInternal, "nuaig-internal");
    case "acme-senior-living":
      return checked(acmeSeniorLiving, "acme-senior-living");
    case "presbyterian-senior-living":
      return checked(presbyterianSeniorLiving, "presbyterian-senior-living");
    default:
      throw unresolvableClient();
  }
}

/**
 * The id a config is registered under must match the one it declares, because
 * the clientId namespaces every audit record.
 */
function checked(config: ClientConfig, registeredAs: string): ClientConfig {
  if (config.clientId !== registeredAs) {
    throw new Error(
      `Config registered under "${registeredAs}" declares clientId "${config.clientId}". ` +
        `These must match — the clientId is used to namespace audit records.`,
    );
  }

  return validateClientConfig(config);
}

/** Distinguishes "not set" from "set to something unknown" — different fixes. */
function unresolvableClient(): Error {
  const clientId = process.env.NEXT_PUBLIC_CLIENT_ID;
  const known = KNOWN_CLIENT_IDS.join(", ");

  return clientId
    ? new Error(
        `NEXT_PUBLIC_CLIENT_ID is "${clientId}", which has no config under ` +
          `config/clients/. Known clients: ${known}.`,
      )
    : new Error(
        `NEXT_PUBLIC_CLIENT_ID is not set. One deployment serves one client; ` +
          `set it to one of: ${known}.`,
      );
}

/** The active client for this deployment. Validated on first import. */
export const activeClient: ClientConfig = resolveClientConfig();

export * from "./types";
export { ClientConfigError, validateClientConfig } from "./validate";
