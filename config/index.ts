import { clientConfig as acmeSeniorLiving } from "./clients/acme-senior-living";
import { clientConfig as nuaigInternal } from "./clients/nuaig-internal";
import { clientConfig as presbyterianSeniorLiving } from "./clients/presbyterian-senior-living";
import type { ClientConfig } from "./types";
import { validateClientConfig } from "./validate";

/**
 * Every client this codebase can be deployed as.
 *
 * A static map rather than a dynamic `import()` of a path built from an env
 * var: it keeps the bundle tree-shakeable, and an unknown `NEXT_PUBLIC_CLIENT_ID`
 * fails loudly at startup instead of resolving to `undefined` at runtime.
 */
const CLIENT_CONFIGS: Readonly<Record<string, ClientConfig>> = {
  [nuaigInternal.clientId]: nuaigInternal,
  [acmeSeniorLiving.clientId]: acmeSeniorLiving,
  [presbyterianSeniorLiving.clientId]: presbyterianSeniorLiving,
};

/**
 * Referenced as a literal property access so the Next.js compiler can inline
 * the value into the client bundle. Destructuring `process.env` would break that.
 */
const CONFIGURED_CLIENT_ID = process.env.NEXT_PUBLIC_CLIENT_ID;

function resolveClientConfig(): ClientConfig {
  const clientId = CONFIGURED_CLIENT_ID;

  if (!clientId) {
    throw new Error(
      `NEXT_PUBLIC_CLIENT_ID is not set. One deployment serves one client; ` +
        `set it to one of: ${Object.keys(CLIENT_CONFIGS).join(", ")}.`,
    );
  }

  const config = CLIENT_CONFIGS[clientId];
  if (!config) {
    throw new Error(
      `NEXT_PUBLIC_CLIENT_ID is "${clientId}", which has no config under ` +
        `config/clients/. Known clients: ${Object.keys(CLIENT_CONFIGS).join(", ")}.`,
    );
  }

  if (config.clientId !== clientId) {
    throw new Error(
      `Config registered under "${clientId}" declares clientId "${config.clientId}". ` +
        `These must match — the clientId is used to namespace audit records.`,
    );
  }

  return validateClientConfig(config);
}

/** The active client for this deployment. Validated on first import. */
export const activeClient: ClientConfig = resolveClientConfig();

export * from "./types";
export { ClientConfigError, validateClientConfig } from "./validate";
