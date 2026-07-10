#!/bin/bash
set -e

echo "🚀 Deploying FixIndia Backend to Oracle Cloud..."

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Configuration
APP_DIR="/home/ubuntu/fixindia"
SERVER_DIR="$APP_DIR/server"

# Navigate to app directory
cd $APP_DIR

# Pull latest code
echo "📥 Pulling latest code..."
git fetch --all
git reset --hard origin/main

# Navigate to server directory
cd $SERVER_DIR

# Install dependencies
echo "📦 Installing dependencies..."
bun install --production

# Run database migrations
echo "🗄️  Running database migrations..."
if [ -f "schema.sql" ]; then
  psql $DATABASE_URL -f schema.sql || echo "⚠️  Migration failed or already applied"
fi

# Check if PM2 is installed
if ! command -v pm2 &> /dev/null; then
  echo "📦 Installing PM2..."
  npm install -g pm2
fi

# Start or restart the application.
# IMPORTANT: never `pm2 delete` + `pm2 start` — that drops the service and, if a
# stray (non-PM2) bun process is still bound to the port, SO_REUSEPORT leaves TWO
# listeners round-robining between old and new code (a real auth-bypass we hit in
# prod). So: (1) kill any listener that PM2 does NOT own, then (2) startOrReload.
echo "🔄 Reloading application..."
PM2_PIDS="$(pm2 jlist 2>/dev/null | python3 -c 'import sys,json;d=json.load(sys.stdin);print(" ".join(str(p["pid"]) for p in d if p.get("pid")))' 2>/dev/null || true)"
for port in 6969 6970; do
  for pid in $(lsof -ti tcp:$port 2>/dev/null || true); do
    case " $PM2_PIDS " in
      *" $pid "*) : ;;                        # owned by PM2 — leave it
      *) echo "  ⚠️  killing stray listener pid $pid on :$port"; kill -9 "$pid" 2>/dev/null || true ;;
    esac
  done
done
pm2 startOrReload ecosystem.config.json --update-env
pm2 save

# Health check
echo "🏥 Running health check..."
sleep 3
# Use the readiness probe (verifies the DB is actually reachable) rather than
# the liveness-only /health endpoint, so a broken DB fails the deploy.
if curl -f http://localhost:6969/health/ready > /dev/null 2>&1 && curl -f http://localhost:6970/health/ready > /dev/null 2>&1; then
  echo -e "${GREEN}✅ Deployment successful!${NC}"
  pm2 status
else
  echo -e "${RED}❌ Health check failed!${NC}"
  echo "--- Public API logs ---"
  pm2 logs fixindia-api --lines 20 --no-colors || true
  echo "--- Admin API logs ---"
  pm2 logs fixindia-admin-api --lines 20 --no-colors || true
  exit 1
fi

echo "🎉 Deployment complete!"
