# S3 configuration for maintenance request attachments (M6.5)

This is the exact AWS configuration required for direct-to-S3 presigned
uploads/downloads of maintenance request photos (`src/lib/s3.ts`,
`src/modules/maintenance/attachments.service.ts`). It intentionally asks for
the minimum needed — no public access, no wildcard IAM resource, no
permissions beyond what the code actually calls.

## Why this exists

Two AWS-side settings gate this feature and **cannot be configured from
application code** — they have to be applied directly against the bucket /
IAM principal by someone with sufficient AWS permissions:

1. **Bucket CORS** — without it, a browser's direct PUT/GET to the presigned
   URL is blocked at the CORS preflight stage before it ever reaches S3.
2. **IAM permissions on the signing principal** — a presigned URL is only
   ever as permissive as the AWS identity that signed it. If that identity
   lacks `s3:PutObject`/`s3:GetObject` on the target key, the presigned URL
   itself will return `403 AccessDenied` when used, even though it was
   generated successfully.

As of this writing, the IAM user this backend's local/dev environment runs
as (`waslsign-devops`) can create the bucket but is **not** authorized to
set its CORS policy, Block Public Access configuration, or default
encryption — every attempt returned `AccessDenied`. Real browser uploads
will fail until someone with broader permissions applies the configuration
below.

## 1. Bucket-level settings (apply once)

Keep all of these — nothing here should be loosened:

- **Block Public Access: ON** (all four sub-settings) — presigned URLs work
  through IAM/query-string signing, never through public access.
- **No public-read (or any public) bucket ACL or bucket policy.**
- **Default encryption: SSE-S3 (`AES256`)** — recommended, not required for
  the presigned flow itself to function.
- **Bucket policy: none required.** Access is controlled entirely through
  the IAM permissions in §3, not a bucket policy. Don't add one unless a
  future requirement needs it.

```
aws s3api put-public-access-block \
  --bucket wasl-property-uploads-dev \
  --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true

aws s3api put-bucket-encryption \
  --bucket wasl-property-uploads-dev \
  --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
```

## 2. CORS configuration (apply once, update when the frontend's production origin is known)

Only `PUT` (upload) and `GET` (view) are ever issued by this feature.
`Content-Type` is the only header the app sends that isn't CORS-"simple"
(image content types trigger a preflight), so it's the only one that needs
to be allowed explicitly.

Origins are environment-specific — list each real frontend origin
individually, never `"*"`. Today only the local dev origin is known:

```json
{
  "CORSRules": [
    {
      "AllowedOrigins": ["http://localhost:5174"],
      "AllowedMethods": ["PUT", "GET"],
      "AllowedHeaders": ["Content-Type"],
      "ExposeHeaders": ["ETag"],
      "MaxAgeSeconds": 3000
    }
  ]
}
```

Apply with:

```
aws s3api put-bucket-cors \
  --bucket wasl-property-uploads-dev \
  --cors-configuration file://cors.json
```

**When a production frontend domain exists**, add it as a second entry
(same shape, `AllowedOrigins: ["https://<production-domain>"]`) — do not
combine origins into one array with different intents; keep dev and
production as separate, explicit rules so either can be changed or removed
independently. Never add a wildcard origin (`"*"`) since the bucket would
then accept direct uploads from any website that got hold of a presigned
URL's structure — the presigned signature already limits who can _obtain_ a
valid URL, but CORS is what stops an unrelated origin's page from
using one in a victim's browser session.

## 3. IAM permissions for the signing principal

This is the AWS identity the backend runs as (picked up via the default AWS
SDK credential chain — e.g. `~/.aws/credentials` locally, an instance/task
role in a deployed environment). It needs exactly two S3 actions, scoped to
the one key prefix this feature ever writes to or reads from
(`organisations/{orgId}/maintenance-requests/{requestId}/{file}` — see
`attachments.service.ts`'s `storageKeyPrefix`). No `ListBucket`,
`DeleteObject`, `PutObjectAcl`, or bucket-admin actions are needed —the app
never calls them.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "MaintenanceAttachmentsReadWrite",
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject"],
      "Resource": "arn:aws:s3:::wasl-property-uploads-dev/organisations/*/maintenance-requests/*/*"
    }
  ]
}
```

The two `*` segments are unavoidable (organisation and request IDs are
generated at runtime) but the policy still can't reach any other prefix,
any other bucket, or any bucket-level action — this is as narrow as the
resource ARN can get while matching the app's actual key layout.

If the same AWS account/user is shared across environments (dev/test/prod),
prefer a **separate bucket per environment** (as already done —
`wasl-property-uploads-dev` for dev; a hypothetical
`wasl-property-uploads-prod` for production) over trying to separate
environments by prefix within one bucket, so this IAM policy's bucket name
can stay a single hard-coded ARN rather than a broader multi-bucket
resource list.

## 4. Required application configuration

Already wired up via `src/config/env.ts` — no code changes needed once the
above is applied:

| Env var                              | Purpose                                                     |
| ------------------------------------ | ----------------------------------------------------------- |
| `AWS_REGION`                         | Region the bucket lives in (e.g. `me-central-1`).           |
| `S3_BUCKET_NAME`                     | The bucket from §1/§2/§3.                                   |
| `MAINTENANCE_ATTACHMENT_MAX_FILES`   | Max photos per request (app-level limit, not AWS-enforced). |
| `MAINTENANCE_ATTACHMENT_MAX_SIZE_MB` | Max size per photo (app-level limit, not AWS-enforced).     |

AWS credentials themselves are **not** app config — they come from the
default SDK credential chain (environment variables, `~/.aws/credentials`,
or an instance/task role), matching how every other AWS-touching part of
this infrastructure is expected to authenticate.

## 5. Verifying it end-to-end

Once §1–§3 are applied, confirm with a real browser (not curl — curl
doesn't enforce CORS, so it would pass even if the bucket's CORS policy is
still missing):

1. Sign in as a resident, open **Report an issue**, attach a photo, submit.
2. The request should show 0 failed uploads (no "couldn't be uploaded"
   warning).
3. Open the request's detail page — the photo thumbnail should load from a
   real, freshly presigned S3 GET URL.

If step 2 still fails with every photo unattached, check the browser
console for a CORS error (§2) versus a `403`/`AccessDenied` on the PUT
itself (§3 — the signing principal's IAM policy) to tell the two failure
modes apart.
