# S3 Governance Portal

A multi-tenant S3 access-management portal, built and operated by **Nuaig**.

Users sign in with Cognito, see only the buckets their group membership grants,
and can browse, search, download and (where permitted) upload files. Every
access and administrative action is recorded in an append-only audit log.

One deployment serves one client. Client-specific detail — display name, logo,
buckets, groups — comes entirely from a config file, never from the code.

## The core constraint

**This application cannot delete or overwrite anything, for any role, including
administrators.** That is enforced in the generated IAM policy, in an explicit
`Deny`, in a permissions boundary on every group role, and by the absence of any
client code path. Uploads that would collide are stored alongside the original
rather than replacing it.

See [`docs/no-destructive-actions.md`](docs/no-destructive-actions.md).

## Getting started

Requires Node 20+ and AWS credentials for the target account.

```bash
npm install
export NEXT_PUBLIC_CLIENT_ID=nuaig-internal   # PowerShell: $env:NEXT_PUBLIC_CLIENT_ID="nuaig-internal"

npm run sandbox      # deploy a personal backend; writes amplify_outputs.json
npm run dev          # http://localhost:3000
```

`npm run dev` works before a sandbox exists, but the app will tell you the
backend is not deployed rather than pretending to work.

Once a backend is up, create the first administrator with the AWS CLI — the
portal has no self-registration, so there is no bootstrap path through the UI:

```bash
aws cognito-idp admin-create-user --user-pool-id <pool-id> \
  --username you@example.com \
  --user-attributes Name=email,Value=you@example.com Name=email_verified,Value=true \
                    Name=given_name,Value=First Name=family_name,Value=Last
aws cognito-idp admin-add-user-to-group --user-pool-id <pool-id> \
  --username you@example.com --group-name admin
```

Then optionally seed the showcase buckets with synthetic sample files:

```bash
npm run seed:showcase -- --dry-run
npm run seed:showcase
```

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm run verify` | Typecheck, lint and test — run before committing |
| `npm test` | Tests only |
| `npm run sandbox` | Deploy a personal Amplify backend |
| `npm run seed:showcase` | Write synthetic sample files to the showcase buckets |
| `npm run prepare:buckets` | Enable versioning and add the portal's CORS rule on a client's existing buckets (`--account <id>` required; `--dry-run` first) |

## Onboarding a new client

1. Copy `config/clients/acme-senior-living.ts` to `config/clients/<client-id>.ts`.
2. Fill in the display name, buckets and groups. Set `bucketProvisioning` to
   `"existing"` when the buckets already live in the client's account.
3. Register it in the `CLIENT_CONFIGS` map in `config/index.ts`.
4. Deploy with `NEXT_PUBLIC_CLIENT_ID=<client-id>`.

The config is validated on import, so a grant pointing at a bucket that does not
exist — or a missing admin group — fails the build rather than the deployment.

## Documentation

- [`docs/no-destructive-actions.md`](docs/no-destructive-actions.md) — how the
  no-delete guarantee is enforced, in four independent places
- [`docs/decisions/group-management.md`](docs/decisions/group-management.md) —
  why runtime IAM editing was chosen, and the guardrails that bound it
- [`docs/audit-coverage.md`](docs/audit-coverage.md) — what the audit log covers,
  and the gaps it does not
- [`docs/deployment-plan.md`](docs/deployment-plan.md) — the client deployment
  runbook, including what the client must provide
- [`docs/administrator-guide.md`](docs/administrator-guide.md) — handed to the
  client's administrator
- [`CLAUDE.md`](CLAUDE.md) — project instructions and architecture notes

## Decisions a real deployment still needs

These are flagged rather than assumed:

- **Session duration.** Set in `config/session.ts`: 30-minute access tokens,
  12-hour refresh, 30-minute idle sign-out.
- **Invitation email content.** Currently Cognito's default template.
- **Audit retention.** The log is append-only with no expiry; retention is a
  lifecycle decision on the DynamoDB table.
- **Monitoring.** `docs/audit-coverage.md` recommends CloudWatch alarms; none are
  configured by this repo.
- **Failed sign-ins** are not recorded — see the gaps in `docs/audit-coverage.md`.
