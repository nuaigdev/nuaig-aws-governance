# Client deployment plan

The runbook for deploying the portal into a client's AWS account. Everything
that needs deciding has been decided here, so the deployment day is execution,
not assessment.

**Deployment model.** The client has no AWS administrator and no AWS
background. They provision one temporary access identity for us; Nuaig performs
the whole deployment and hands over a working portal. The client's four buckets
already exist and are **connected, never created or modified in content**.

**Hosting.** AWS Amplify Hosting on the default `*.amplifyapp.com` URL. It is
served over HTTPS with an AWS-managed certificate — no domain or certificate work.

---

## Part A — What we need from the client

Send this list as-is. Nothing else is required of them.

| # | Item | Notes for the client |
| --- | --- | --- |
| 1 | **AWS account ID** and preferred **region** | 12-digit number, shown top-right in the AWS console. |
| 2 | **One temporary deployment identity** for Nuaig | A single IAM role or user with administrator permissions. See "Creating the access identity" below. Removed after handover. |
| 3 | The **four bucket names**, exactly as in S3 | Spelling matters — the portal connects by name. |
| 4 | **First administrator**: first name, last name, work email | Receives the invitation. Must be able to install an authenticator app. |
| 5 | **Client logo** (SVG preferred, PNG accepted) and the exact **display name** | Until supplied, the display name shows as text. |
| 6 | **Who goes in which group** | Can be sent after launch — the administrator manages it in the portal. |

### Creating the access identity (client-side steps, plain language)

Give the client these steps, or do it on a screen-share:

1. Sign in to the AWS console as the account owner.
2. Open **IAM → Users → Create user**. Name it `nuaig-deployment`.
3. Choose **Attach policies directly** and attach `AdministratorAccess`.
4. Open the user's **Security credentials** tab and choose **Create access key**,
   use case **Command Line Interface**. Send the two values to Nuaig through the
   agreed secure channel (never email).
5. Tell us when the go-live is confirmed; they then **delete the access key and
   the user** in IAM. Nuaig does not retain the credentials.

Preferred where the client can manage it: an IAM role that trusts Nuaig's AWS
account, so no key is ever sent. Either way the identity is temporary.

> The keys are used only from the deployer's machine, only for the deployment
> window, and are never committed or stored in the repo. The application
> itself holds no static credentials at any time.

---

## Part B — Preparing the buckets (Nuaig, automated)

The portal's browser talks to S3 directly, so two things about the client's
existing buckets must be right. Both are handled by one script, run by us.

```bash
npm run prepare:buckets -- --account <account-id> --dry-run   # report only
npm run prepare:buckets -- --account <account-id>             # applies the changes below
```

The script reads the bucket list from the active client config, and for each
bucket:

1. **Turns on versioning** if it is off. Versioning is what makes an accidental
   overwrite recoverable, and the portal's "never overwrite" guarantee relies on
   it. Enabling it changes no existing object.
2. **Sets the CORS rule** allowing the portal's URL: `GET`/`HEAD`/`PUT`/`POST`,
   no `DELETE`. It merges with any existing rules rather than replacing them,
   and never removes a rule it did not add.
3. **Reports** block-public-access and SSL-only-policy status. It reports
   these but does not change them; anything unexpected is raised to the client
   rather than silently altered.

`--account` is mandatory and is sent with every call as the expected bucket owner, so a wrong profile, or a bucket in a different account, fails instead of being modified. It also names a missing bucket, and
prints exactly what it would change before changing anything.

**Data-protecting behaviour:** the script never deletes anything, never writes
objects, and never touches bucket policy or encryption.

---

## Part C — Deployment steps (Nuaig)

Do these in order. Each step has a check that must pass before continuing.

### 1. Prepare the machine

```bash
git clone <repo> && cd nuaig-aws-governance
npm ci
npm run verify                       # must pass: typecheck, lint, tests
aws configure --profile <client>     # the client's temporary identity
aws sts get-caller-identity --profile <client>   # confirm the account ID
```

**Check:** the account ID printed matches Part A item 1.

### 2. Register the client config

Create `config/clients/<client-id>.ts` from `acme-senior-living.ts`:
`bucketProvisioning: "existing"`, the four bucket names, groups, display name,
and `logo` if supplied (file into `public/branding/`). Register it in
`config/index.ts`. Config validation runs at import, so mistakes fail here.

**Check:** `NEXT_PUBLIC_CLIENT_ID=<client-id> npm run verify` passes.

### 3. Bootstrap the account (once per account and region)

```bash
npx cdk bootstrap aws://<account>/<region> --profile <client>
```

### 4. Create the hosting app

In the client's AWS console (Amplify → Create app), connect the Nuaig
repository and branch, and set the environment variable
`NEXT_PUBLIC_CLIENT_ID=<client-id>`. First build runs the backend and frontend
together through the branch pipeline (standard CloudFormation mode; the sandbox
"Express mode trap" in CLAUDE.md does not apply).

Amplify needs authorising against the repository host once; Nuaig does this with
its own repository credentials, not the client's.

**Check:** the build finishes green, and Amplify shows a
`https://<branch>.<app-id>.amplifyapp.com` URL. Note it.

### 5. Prepare the buckets against the live URL

```bash
PORTAL_ALLOWED_ORIGINS=https://<branch>.<app-id>.amplifyapp.com \
  npm run prepare:buckets -- --account <account-id> --profile <client> --dry-run
# review the output, then:
PORTAL_ALLOWED_ORIGINS=https://<branch>.<app-id>.amplifyapp.com \
  npm run prepare:buckets -- --account <account-id> --profile <client>
```

The URL is only known after step 4, which is why this is a separate step.
Then set `PORTAL_ALLOWED_ORIGINS` in the Amplify environment so later deploys
carry the same value.

**Check:** the script's final report lists every bucket as versioned, with the
portal origin present in CORS.

### 6. Create the first administrator

Using the pool ID from the Amplify outputs (`amplify_outputs.json` / Cognito
console):

```bash
aws cognito-idp admin-create-user --user-pool-id <pool-id> --profile <client> \
  --username admin@client.example \
  --user-attributes Name=email,Value=admin@client.example Name=email_verified,Value=true \
                    Name=given_name,Value=First Name=family_name,Value=Last
aws cognito-idp admin-add-user-to-group --user-pool-id <pool-id> --profile <client> \
  --username admin@client.example --group-name admin
```

The administrator signs in from the emailed invitation, sets a password, and
scans the MFA QR code with an authenticator app. From here, all user and group
management is done inside the portal.

### 7. Smoke test — run through as the administrator, then as a scoped user

| Check | Expected |
| --- | --- |
| Sign in with MFA | Succeeds; sign-in with a wrong password does not. |
| Home page | Lists all four buckets for the administrator. |
| Open a bucket, open a folder, use the path bar | Lists content; clicking a path segment jumps back. |
| Download a file | Downloads; an entry appears in the audit log. |
| Create a test user in one group, sign in as them | They see only that group's buckets. |
| Reset the test user's password from the Users page | Emailed code arrives; new password works; audit entry exists. |
| Look for any delete / overwrite control anywhere | None exists. |
| Audit log page | Shows the login, list, download and admin actions above. |
| Leave a session idle | Signs out after the idle limit. |

Disable the test user afterwards (offboarding keeps the audit trail intact).

### 8. Handover

- Give the administrator `docs/administrator-guide.md` (adding users, groups,
  password resets, offboarding).
- Confirm to the client that they can now **delete the deployment access key and
  user** (Part A item 2). Verify by attempting a call with the old profile — it
  must now fail.
- Record in the project notes: account ID, region, Amplify app ID, portal URL,
  date, and who ran the deployment. No credentials.

---

## Part D — Known operating notes

- **Sessions:** 30 minutes idle sign-out in the UI; access tokens are short
  lived; refresh tokens last 12 hours. Changing these is a code change and a
  redeploy.
- **Password reset:** administrators reset another user's password from the
  Users page. Cognito emails the user a one-time code and forces a new password
  at their next sign-in; MFA stays in force.
- **Failed sign-ins** are not shown in the audit log (see
  `docs/audit-coverage.md`).
- **Buckets are never deleted by this app.** If the portal is ever removed,
  the four buckets and their contents are untouched: they were imported, not
  created.
- **Rollback:** redeploy the previous Amplify build. Bucket configuration
  changes from Part B are additive and safe to leave in place.
