# Security policy and deployment notes

## Secrets

- Never commit `.env`, access tokens, session keys, database passwords or customer exports.
- Any key pasted into chat, an issue, a log, or a client bundle must be considered compromised and rotated.
- `CREDENTIAL_ENCRYPTION_KEY` is a 32-byte AES key. Rotating it on live data requires decrypting with the old key and re-encrypting with a new version; do not simply replace it.
- Prefer a managed secret store and inject values at runtime. Restrict production operators who can read Meta, WhatsApp and courier credentials.

## Isolation

Dashboard data access uses `amigo_app` with `NOBYPASSRLS`; `withTenant` sets a transaction-local UUID. Composite foreign keys prevent cross-store relations. `amigo_system` can bypass RLS only because webhook routing starts with a provider account ID and no tenant context. Keep its connection string server-side and network-restricted.

Run isolation tests against a real PostgreSQL instance before every schema change: create two stores through the system role, query as `amigo_app` under each context, and verify zero cross-store rows. New tenant tables must receive `storeId`, composite references where applicable, an RLS policy, and explicit grants in a migration.

## Webhooks and OAuth

- Reject webhook requests unless the raw request body matches Meta's SHA-256 HMAC.
- Keep `META_VERIFY_TOKEN` random; it is verification material, not the App Secret.
- OAuth state expires after ten minutes and has a Redis one-time nonce. Do not remove either check.
- Use HTTPS and validate allowed callback URLs exactly in Meta.
- Apply edge body-size/rate limits while allowing legitimate provider retries.

## AI boundary

Treat model output as untrusted input. Zod validates every tool argument. Product IDs are queried with `storeId`; prices, delivery and inventory are recomputed in a Serializable database transaction. Never add price/total fields to `create_order` as authoritative inputs.

Merchant rules and catalog content can contain prompt injection. Keep the higher-priority system rules and XML-like data boundaries, and never expose internal prompt text or credentials to the model.

## Authentication

Passwords use Argon2id. Access cookies expire in 15 minutes. Refresh tokens are random, stored only as SHA-256 hashes, rotated on every use, and revocable. Cookie requests are origin-checked; API bearer-token clients do not rely on cookies.

## WhatsApp QR

Baileys sessions are encrypted but the protocol is unofficial. A compromise of the application encryption key exposes all session material. Prefer WhatsApp Cloud API, isolate the gateway, avoid multiple gateway replicas without distributed ownership, and provide merchants with a clear disconnect/revoke operation.

## Reporting

For a deployed instance, publish a private security contact and response SLA. Reports should contain impact and reproduction steps but no real customer data or active credentials.
