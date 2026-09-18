"use client";

import { Amplify } from "aws-amplify";
import { generateClient } from "aws-amplify/data";

import outputs from "../../../amplify_outputs.json";
import type { Schema } from "../../../amplify/data/resource";

/**
 * Configures Amplify once, in the browser.
 *
 * No static AWS credentials are involved anywhere: the Identity Pool exchanges
 * the user's Cognito tokens for temporary, scoped credentials bound to their
 * group's role. `amplify_outputs.json` holds only public endpoint identifiers.
 */

let configured = false;

export interface CustomOutputs {
  readonly clientId: string;
  readonly buckets: readonly {
    readonly id: string;
    readonly bucketName: string;
    readonly region: string;
  }[];
}

/**
 * True when `amplify_outputs.json` is still the placeholder written by
 * `scripts/ensure-amplify-outputs.mjs`.
 */
export function isPlaceholderConfig(): boolean {
  return "$placeholder" in (outputs as Record<string, unknown>);
}

export class BackendNotDeployedError extends Error {
  constructor() {
    super(
      "The Amplify backend has not been deployed for this checkout. " +
        "Run `npm run sandbox` to deploy one and generate amplify_outputs.json.",
    );
    this.name = "BackendNotDeployedError";
  }
}

export function configureAmplify(): void {
  if (configured) return;

  if (isPlaceholderConfig()) {
    // Fail here, with an instruction, rather than letting every call fail
    // later with an opaque network error.
    throw new BackendNotDeployedError();
  }

  Amplify.configure(outputs as never, { ssr: false });
  configured = true;
}

/** The custom outputs block published by `backend.ts`. */
export function customOutputs(): CustomOutputs {
  const custom = (outputs as { custom?: CustomOutputs }).custom;
  if (!custom) throw new BackendNotDeployedError();
  return custom;
}

/** Physical bucket name and region for a config bucket id. */
export function resolveBucket(bucketId: string): {
  bucketName: string;
  region: string;
} {
  const match = customOutputs().buckets.find((b) => b.id === bucketId);
  if (!match) {
    throw new Error(
      `Bucket "${bucketId}" is in the client config but absent from the ` +
        `deployed outputs. Redeploy the backend so the two agree.`,
    );
  }
  return { bucketName: match.bucketName, region: match.region };
}

let dataClient: ReturnType<typeof generateClient<Schema>> | null = null;

/** The GraphQL data client. Created lazily so Amplify is configured first. */
export function getDataClient() {
  configureAmplify();
  dataClient ??= generateClient<Schema>({ authMode: "userPool" });
  return dataClient;
}
