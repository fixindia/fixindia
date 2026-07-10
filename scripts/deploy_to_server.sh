#!/usr/bin/env bash
set -e

echo "=========================================="
echo "🚀 Local deployment script for FixIndia VM"
echo "=========================================="

KEY_PATH="SSH/fixindia.key"
REMOTE_USER="ubuntu"
REMOTE_HOST="129.159.228.26"
REMOTE_DIR="/home/ubuntu/fixindia"

# Check if SSH key exists
if [ ! -f "$KEY_PATH" ]; then
  echo "❌ SSH Key not found at $KEY_PATH"
  exit 1
fi

echo "1. Creating remote directory structure..."
ssh -o StrictHostKeyChecking=no -i "$KEY_PATH" "$REMOTE_USER@$REMOTE_HOST" "mkdir -p $REMOTE_DIR"

echo "2. Uploading files via rsync..."
rsync -avz -e "ssh -o StrictHostKeyChecking=no -i $KEY_PATH" \
  --exclude 'node_modules' \
  --exclude '.git' \
  --exclude 'dist' \
  --exclude 'server/node_modules' \
  --exclude '.env' \
  --exclude 'server/.env' \
  --exclude 'server/logs' \
  ./ "$REMOTE_USER@$REMOTE_HOST:$REMOTE_DIR/"

echo "3. Running provisioning and setting up system dependencies..."
ssh -o StrictHostKeyChecking=no -i "$KEY_PATH" "$REMOTE_USER@$REMOTE_HOST" "chmod +x $REMOTE_DIR/scripts/setup_vm.sh && sudo $REMOTE_DIR/scripts/setup_vm.sh"

echo "4. Setting up server environment variables (.env)..."
# Generate a secure 64-char hex ADMIN_KEY (config.ts requires >= 32 chars in prod).
# SECURITY: The key is written straight into the remote .env and is NEVER echoed to
# stdout — build logs and shell history are an exfiltration path. Retrieve it later
# with:  ssh ... "grep '^ADMIN_KEY=' $REMOTE_DIR/server/.env"
ADMIN_KEY=$(openssl rand -hex 32)
ssh -o StrictHostKeyChecking=no -i "$KEY_PATH" "$REMOTE_USER@$REMOTE_HOST" ADMIN_KEY="$ADMIN_KEY" REMOTE_DIR="$REMOTE_DIR" 'bash -s' <<'REMOTE'
if [ ! -f "$REMOTE_DIR/server/.env" ]; then
  ( umask 077
    cat > "$REMOTE_DIR/server/.env" << EOF
# Real values must be filled in on the server — never commit this file.
# Rotate anything that leaks (see docs/SECRET-ROTATION.md).
DATABASE_URL=postgresql://fixindia:CHANGE_ME_STRONG_PASSWORD@localhost:5432/fixindia
ADMIN_KEY=$ADMIN_KEY
CLERK_SECRET_KEY=sk_live_CHANGE_ME
STORJ_ENDPOINT=https://gateway.storjshare.io
STORJ_BUCKET=civicmap
STORJ_ACCESS_KEY=CHANGE_ME
STORJ_SECRET_KEY=CHANGE_ME
GROQ_API_KEYS=CHANGE_ME
NODE_ENV=production
EOF
  )
  chmod 600 "$REMOTE_DIR/server/.env"
  echo "Created new server/.env (ADMIN_KEY written to file, not printed)."
else
  echo "server/.env already exists, skipping creation."
fi
REMOTE
# Clear the key from the local shell environment.
unset ADMIN_KEY

echo "5. Running database migrations and seeding data..."
# PGPASSWORD is read from the server's own .env (DATABASE_URL) rather than being
# hardcoded here. This keeps the DB password out of this script and out of logs.
ssh -o StrictHostKeyChecking=no -i "$KEY_PATH" "$REMOTE_USER@$REMOTE_HOST" "bash -c '
set -a; . $REMOTE_DIR/server/.env; set +a
export PGPASSWORD=\$(printf %s \"\$DATABASE_URL\" | sed -E \"s|.*://[^:]+:([^@]+)@.*|\\1|\")
echo \"Running schema.sql...\"
psql -h localhost -U fixindia -d fixindia -f $REMOTE_DIR/server/schema.sql

echo \"Seeding MLAs...\"
psql -h localhost -U fixindia -d fixindia -f $REMOTE_DIR/server/populate_mlas.sql
psql -h localhost -U fixindia -d fixindia -f $REMOTE_DIR/server/populate_more_mlas.sql

echo \"Seeding News...\"
psql -h localhost -U fixindia -d fixindia -f $REMOTE_DIR/server/populate_news.sql
psql -h localhost -U fixindia -d fixindia -f $REMOTE_DIR/server/populate_more_news.sql

echo \"Fixing timestamps...\"
psql -h localhost -U fixindia -d fixindia -f $REMOTE_DIR/server/fix_timestamps.sql
'"

echo "6. Running npm install & starting PM2 service..."
ssh -o StrictHostKeyChecking=no -i "$KEY_PATH" "$REMOTE_USER@$REMOTE_HOST" "bash -c '
export PATH=\"/home/ubuntu/.bun/bin:\$PATH\"
cd $REMOTE_DIR/server
bun install --production
pm2 delete fixindia-api 2>/dev/null || true
pm2 start ecosystem.config.json
pm2 save
'"

echo "=========================================="
echo "✅ Server Setup & Deployment Complete!"
echo "=========================================="
echo "Backend URL: https://api.enjoyxd.eu.org"
echo "⚠️  IMPORTANT: SSH to the server and fill in real values in $REMOTE_DIR/server/.env"
echo "    (DATABASE_URL password, CLERK_SECRET_KEY, Storj + Groq keys)."
echo "    Retrieve the generated ADMIN_KEY with:"
echo "      ssh -i $KEY_PATH $REMOTE_USER@$REMOTE_HOST \"grep '^ADMIN_KEY=' $REMOTE_DIR/server/.env\""
echo "=========================================="
