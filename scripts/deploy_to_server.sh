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
# Generate a secure 32-character hex key for ADMIN_KEY
ADMIN_KEY=$(openssl rand -hex 16)
ssh -o StrictHostKeyChecking=no -i "$KEY_PATH" "$REMOTE_USER@$REMOTE_HOST" "bash -c '
if [ ! -f $REMOTE_DIR/server/.env ]; then
  cat > $REMOTE_DIR/server/.env << EOF
DATABASE_URL=postgresql://fixindia:fixindia_secure_pass@localhost:5432/fixindia
ADMIN_KEY=$ADMIN_KEY
STORJ_ENDPOINT=https://gateway.storjshare.io
STORJ_BUCKET=civicmap
STORJ_ACCESS_KEY=placeholder_access_key_change_me
STORJ_SECRET_KEY=placeholder_secret_key_change_me
GROQ_API_KEYS=placeholder_groq_key_change_me
NODE_ENV=production
EOF
  echo \"Created new server/.env with generated ADMIN_KEY: $ADMIN_KEY\"
else
  echo \"server/.env already exists, skipping creation.\"
fi
'"

echo "5. Running database migrations and seeding data..."
ssh -o StrictHostKeyChecking=no -i "$KEY_PATH" "$REMOTE_USER@$REMOTE_HOST" "bash -c '
export PGPASSWORD=fixindia_secure_pass
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
echo "Generated ADMIN_KEY: $ADMIN_KEY"
echo "⚠️  IMPORTANT: Please SSH to the server and update $REMOTE_DIR/server/.env with your real Storj and Groq keys!"
echo "=========================================="
