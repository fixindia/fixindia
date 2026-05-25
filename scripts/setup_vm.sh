#!/usr/bin/env bash
set -e

echo "=== starting vm provisioning ==="

# 1. Update and install core dependencies
sudo apt-get update
sudo DEBIAN_FRONTEND=noninteractive apt-get upgrade -y
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y \
  curl git unzip build-essential postgresql postgresql-contrib \
  postgis postgresql-16-postgis-3 nginx certbot python3-certbot-nginx \
  iptables-persistent netfilter-persistent

# 2. Install Node.js 20 LTS (using NodeSource)
if ! command -v node &> /dev/null; then
  echo "Installing Node.js..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

# 3. Install Bun
if ! command -v bun &> /dev/null; then
  echo "Installing Bun..."
  curl -fsSL https://bun.sh/install | bash
  # Symlink Bun for all users and PM2 access
  sudo ln -sf /home/ubuntu/.bun/bin/bun /usr/local/bin/bun
  export PATH="/home/ubuntu/.bun/bin:$PATH"
fi

# 4. Install PM2 globally
if ! command -v pm2 &> /dev/null; then
  echo "Installing PM2..."
  sudo npm install -g pm2
fi

# 5. Configure iptables firewall (insert before Oracle's reject rule)
echo "Configuring firewall..."
# Check if rule already exists to prevent duplicate entries
if ! sudo iptables -C INPUT -p tcp --dport 80 -j ACCEPT &> /dev/null; then
  sudo iptables -I INPUT 5 -p tcp --dport 80 -j ACCEPT
fi
if ! sudo iptables -C INPUT -p tcp --dport 443 -j ACCEPT &> /dev/null; then
  sudo iptables -I INPUT 5 -p tcp --dport 443 -j ACCEPT
fi
if ! sudo iptables -C INPUT -p tcp --dport 6969 -j ACCEPT &> /dev/null; then
  sudo iptables -I INPUT 5 -p tcp --dport 6969 -j ACCEPT
fi
if ! sudo iptables -C INPUT -p tcp --dport 4000 -j ACCEPT &> /dev/null; then
  sudo iptables -I INPUT 5 -p tcp --dport 4000 -j ACCEPT
fi

sudo netfilter-persistent save

# 6. Configure PostgreSQL Database
echo "Configuring PostgreSQL..."
sudo systemctl start postgresql
sudo systemctl enable postgresql

# Create Database and User
sudo -u postgres psql -c "CREATE USER fixindia WITH PASSWORD 'fixindia_secure_pass';" || true
sudo -u postgres psql -c "ALTER USER fixindia WITH SUPERUSER;" || true
sudo -u postgres psql -c "CREATE DATABASE fixindia OWNER fixindia;" || true
sudo -u postgres psql -d fixindia -c "CREATE EXTENSION IF NOT EXISTS postgis;" || true

# Optimize Postgres for 12GB RAM
echo "Optimizing PostgreSQL configuration..."
sudo -u postgres psql -c "ALTER SYSTEM SET shared_buffers = '3GB';"
sudo -u postgres psql -c "ALTER SYSTEM SET work_mem = '64MB';"
sudo -u postgres psql -c "ALTER SYSTEM SET maintenance_work_mem = '512MB';"
sudo -u postgres psql -c "ALTER SYSTEM SET effective_cache_size = '9GB';"
sudo -u postgres psql -c "ALTER SYSTEM SET checkpoint_completion_target = '0.9';"
sudo -u postgres psql -c "ALTER SYSTEM SET wal_buffers = '16MB';"
sudo -u postgres psql -c "ALTER SYSTEM SET default_statistics_target = '100';"
sudo -u postgres psql -c "ALTER SYSTEM SET random_page_cost = '1.1';"
sudo -u postgres psql -c "ALTER SYSTEM SET effective_io_concurrency = '200';"
sudo systemctl restart postgresql

# 7. Configure Nginx Virtual Host
echo "Configuring Nginx..."

# Generate self-signed certificate if it doesn't exist
sudo mkdir -p /etc/nginx/ssl
if [ ! -f /etc/nginx/ssl/selfsigned.crt ]; then
  echo "Generating self-signed SSL certificate..."
  sudo openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
    -keyout /etc/nginx/ssl/selfsigned.key \
    -out /etc/nginx/ssl/selfsigned.crt \
    -subj "/CN=api.enjoyxd.eu.org"
fi

NGINX_CONF="/etc/nginx/sites-available/api.enjoyxd.eu.org"
sudo bash -c "cat > $NGINX_CONF" << 'EOF'
server {
    listen 80;
    listen [::]:80;
    
    listen 443 ssl;
    listen [::]:443 ssl;
    
    server_name api.enjoyxd.eu.org;
    
    ssl_certificate /etc/nginx/ssl/selfsigned.crt;
    ssl_certificate_key /etc/nginx/ssl/selfsigned.key;

    location / {
        proxy_pass http://127.0.0.1:6969;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        
        # Cloudflare connection headers
        proxy_set_header X-Real-IP $http_cf_connecting_ip;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
EOF

sudo ln -sf $NGINX_CONF /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl restart nginx

echo "=== VM provisioning complete! ==="
