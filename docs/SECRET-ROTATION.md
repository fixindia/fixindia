# 🔐 Secret Rotation Checklist

> **Why this exists:** During development, live secrets ended up on disk in the
> working tree (`server/.env`) and a **live SSH private key** at `SSH/fixindia.key`.
> Anything that has been on a developer laptop, in a shell history, in a chat
> transcript, or in a screenshot must be treated as **compromised** and rotated.
> Rotating invalidates the old value so a leaked copy is worthless.

These files are gitignored and are **not** in git history (only `*.env.example`
is tracked). That is good, but it does **not** un-leak a value that was already
copied elsewhere. Rotate everything below.

---

## 1. SSH keypair (HIGHEST PRIORITY)

The private key `SSH/fixindia.key` grants shell access to the production VM
(`129.159.228.26`, user `ubuntu`). Assume it is compromised.

On a trusted machine:
```bash
ssh-keygen -t ed25519 -f ./fixindia_new.key -C "fixindia-deploy-$(date +%Y%m%d)"
```
Then, while you still have working access to the server:
```bash
# Append the NEW public key
ssh -i SSH/fixindia.key ubuntu@129.159.228.26 \
  "cat >> ~/.ssh/authorized_keys" < fixindia_new.key.pub

# Verify the new key works
ssh -i fixindia_new.key ubuntu@129.159.228.26 "echo OK"

# Remove the OLD public key from the server
ssh -i fixindia_new.key ubuntu@129.159.228.26 \
  "sed -i '/fixindia.key OLD-COMMENT/d' ~/.ssh/authorized_keys"
```
- Delete the old `SSH/fixindia.key` / `.pub` locally.
- Consider rotating the VM entirely if you cannot confirm who accessed the key.

## 2. `ADMIN_KEY`

Grants full admin-API access (SQL shell, PM2 control, AI config).
```bash
openssl rand -hex 32   # 64 hex chars — must be >= 32 per config.ts prod check
```
Update `server/.env` on the VM, then `pm2 restart fixindia-admin-api`.

## 3. `CLERK_SECRET_KEY`

Rotate in the Clerk dashboard → **API Keys** → roll the secret key. Update
`server/.env`. Frontend `VITE_CLERK_PUBLISHABLE_KEY` is public and only needs
changing if you roll the whole instance.

## 4. Database password (`DATABASE_URL`)

```sql
ALTER USER fixindia WITH PASSWORD 'NEW_STRONG_PASSWORD';
```
Update `DATABASE_URL` in `server/.env`, restart both PM2 processes.
Do **not** reuse the placeholder `fixindia_secure_pass` from the deploy script.

## 5. Storj credentials (`STORJ_ACCESS_KEY` / `STORJ_SECRET_KEY`)

In the Storj console, create a new access grant / S3 credentials scoped to the
`civicmap` bucket, disable the old one, update `server/.env`.

## 6. LLM keys (`GROQ_API_KEYS`, `OPENROUTER_API_KEYS`)

Revoke old keys in the Groq / OpenRouter dashboards, issue new ones. These are
comma-separated for rotation, e.g. `GROQ_API_KEYS=key1,key2`.

---

## After rotating

1. Update `server/.env` on the VM (never commit it).
2. `pm2 restart all && pm2 save`
3. Health-check: `curl -f http://localhost:6969/health` and `:6970/health`.
4. Confirm the old SSH key no longer authenticates.

## Prevention going forward

- Keep all secrets out of the repo. `.gitignore` already blocks `.env`, `SSH/`,
  `*.key`, `*.pem`.
- Use a real secrets manager (Oracle Vault, Doppler, 1Password) rather than a
  plaintext `.env` on the box, if/when you scale.
- The deploy script no longer prints the generated `ADMIN_KEY` to stdout — read
  it from the server's `.env` when you need it.
