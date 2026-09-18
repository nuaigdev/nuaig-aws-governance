/**
 * Placeholder for the module `ampx` generates for the "post-authentication" function.
 *
 * Amplify writes the real file here on `ampx sandbox` / `ampx pipeline-deploy`,
 * overwriting this one with the exact environment the deployed function
 * receives. It is checked in so `npm run typecheck` works on a fresh clone,
 * before anyone has deployed a sandbox.
 *
 * Adding a variable here does not create it at runtime — declare it in the
 * function's `resource.ts`, or via `addEnvironment` in `backend.ts`.
 */
export declare const env: {
  // Injected into every Amplify function.
  AWS_ACCESS_KEY_ID: string;
  AWS_SECRET_ACCESS_KEY: string;
  AWS_SESSION_TOKEN: string;
  AWS_REGION: string;
  // Injected because the function is granted access to the data resource.
  AMPLIFY_DATA_GRAPHQL_ENDPOINT: string;
  AMPLIFY_DATA_DEFAULT_NAME: string;
};
