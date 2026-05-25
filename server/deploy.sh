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

# Start or restart the application
echo "🔄 Restarting application..."
pm2 delete fixindia-api 2>/dev/null || true
pm2 delete fixindia-admin-api 2>/dev/null || true
pm2 start ecosystem.config.json
pm2 save

# Health check
echo "🏥 Running health check..."
sleep 3
if curl -f http://localhost:6969/health > /dev/null 2>&1 && curl -f http://localhost:6970/health > /dev/null 2>&1; then
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
