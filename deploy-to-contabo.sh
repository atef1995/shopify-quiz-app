#!/bin/bash
# Deploy Shopify Quiz App to Contabo VPS
# Run this script on your VPS: bash deploy-to-contabo.sh

set -e  # Exit on error

echo "🚀 Starting deployment to Contabo VPS..."

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Ask for domain
echo -e "${YELLOW}What domain/subdomain do you want to use?${NC}"
echo "Example: quiz.yourdomain.com or productquiz.yourdomain.com"
read -p "Domain: " DOMAIN

# Ask for database password
echo -e "${YELLOW}Choose a secure password for the database:${NC}"
read -sp "Database Password: " DB_PASSWORD
echo ""

# Ask for Shopify API Secret
echo -e "${YELLOW}Enter your Shopify API Secret (from Partner Dashboard):${NC}"
read -sp "API Secret: " API_SECRET
echo ""

echo -e "${GREEN}✓ Configuration collected${NC}"

# Step 1: Check and install dependencies
echo -e "${YELLOW}Step 1/12: Checking dependencies...${NC}"

# Check Node.js
if ! command -v node &> /dev/null; then
    echo "Installing Node.js 20..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt install -y nodejs
else
    NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
    if [ "$NODE_VERSION" -lt 18 ]; then
        echo "Upgrading Node.js to version 20..."
        curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
        sudo apt install -y nodejs
    fi
fi
echo -e "${GREEN}✓ Node.js $(node -v) installed${NC}"

# Check PostgreSQL
if ! command -v psql &> /dev/null; then
    echo "Installing PostgreSQL..."
    sudo apt update
    sudo apt install -y postgresql postgresql-contrib
    sudo systemctl start postgresql
    sudo systemctl enable postgresql
fi
echo -e "${GREEN}✓ PostgreSQL installed${NC}"

# Check PM2
if ! command -v pm2 &> /dev/null; then
    echo "Installing PM2..."
    sudo npm install -g pm2
fi
echo -e "${GREEN}✓ PM2 installed${NC}"

# Check Nginx
if ! command -v nginx &> /dev/null; then
    echo "Installing Nginx..."
    sudo apt install -y nginx
    sudo systemctl start nginx
    sudo systemctl enable nginx
fi
echo -e "${GREEN}✓ Nginx installed${NC}"

# Check Git
if ! command -v git &> /dev/null; then
    echo "Installing Git..."
    sudo apt install -y git
fi
echo -e "${GREEN}✓ Git installed${NC}"

# Step 2: Create Database
echo -e "${YELLOW}Step 2/12: Creating database...${NC}"
sudo -u postgres psql -c "CREATE DATABASE shopify_quiz_builder;" 2>/dev/null || echo "Database already exists"
sudo -u postgres psql -c "CREATE USER quiz_app WITH PASSWORD '$DB_PASSWORD';" 2>/dev/null || echo "User already exists"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE shopify_quiz_builder TO quiz_app;"
sudo -u postgres psql -c "ALTER DATABASE shopify_quiz_builder OWNER TO quiz_app;"
echo -e "${GREEN}✓ Database created${NC}"

# Step 3: Clone/Update Repository
echo -e "${YELLOW}Step 3/12: Setting up application...${NC}"
if [ -d "/var/www/shopify-quiz-app" ]; then
    echo "Repository exists, pulling latest changes..."
    cd /var/www/shopify-quiz-app
    git pull origin main
else
    echo "Cloning repository..."
    sudo mkdir -p /var/www
    cd /var/www
    sudo git clone https://github.com/atef1995/shopify-quiz-app.git
    sudo chown -R $USER:$USER shopify-quiz-app
    cd shopify-quiz-app
fi
echo -e "${GREEN}✓ Code updated${NC}"

# Step 4: Install Dependencies
echo -e "${YELLOW}Step 4/12: Installing dependencies...${NC}"
npm install
echo -e "${GREEN}✓ Dependencies installed${NC}"

# Step 5: Create .env File
echo -e "${YELLOW}Step 5/12: Creating environment configuration...${NC}"
cat > .env << EOF
# Shopify App Credentials
SHOPIFY_API_KEY=ccb95c69fbef7812f6a59699510890a1
SHOPIFY_API_SECRET=$API_SECRET

# Database Connection
DATABASE_URL=postgresql://quiz_app:$DB_PASSWORD@localhost:5432/shopify_quiz_builder

# App URL
SHOPIFY_APP_URL=https://$DOMAIN

# Scopes
SCOPES=write_products,read_products,read_customers,write_customers

# Node Environment
NODE_ENV=production

# Server Configuration
PORT=3001
HOST=127.0.0.1
EOF
chmod 600 .env
echo -e "${GREEN}✓ Environment configured${NC}"

# Step 6: Update shopify.app.toml
echo -e "${YELLOW}Step 6/12: Updating Shopify configuration...${NC}"
sed -i "s|application_url = .*|application_url = \"https://$DOMAIN\"|g" shopify.app.toml
sed -i "s|https://product-quiz-builder.fly.dev|https://$DOMAIN|g" shopify.app.toml
sed -i "s|https://shopify-quiz-app.fly.dev|https://$DOMAIN|g" shopify.app.toml
echo -e "${GREEN}✓ Configuration updated${NC}"

# Step 7: Setup Database
echo -e "${YELLOW}Step 7/12: Setting up database schema...${NC}"
npx prisma generate
npx prisma db push --accept-data-loss
echo -e "${GREEN}✓ Database schema created${NC}"

# Step 8: Build Application
echo -e "${YELLOW}Step 8/12: Building application...${NC}"
npm run build
echo -e "${GREEN}✓ Application built${NC}"

# Step 9: Configure Nginx
echo -e "${YELLOW}Step 9/12: Configuring Nginx...${NC}"
sudo tee /etc/nginx/sites-available/shopify-quiz-app > /dev/null << EOF
server {
    listen 80;
    server_name $DOMAIN;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;

        proxy_connect_timeout 600;
        proxy_send_timeout 600;
        proxy_read_timeout 600;
        send_timeout 600;
    }

    client_max_body_size 10M;
}
EOF

sudo ln -sf /etc/nginx/sites-available/shopify-quiz-app /etc/nginx/sites-enabled/
sudo nginx -t
# Ensure Nginx is started before reloading
sudo systemctl start nginx 2>/dev/null || true
sudo systemctl enable nginx
sudo systemctl reload nginx
echo -e "${GREEN}✓ Nginx configured${NC}"

# Step 10: Setup SSL
echo -e "${YELLOW}Step 10/12: Setting up SSL certificate...${NC}"
if ! command -v certbot &> /dev/null; then
    echo "Installing Certbot..."
    sudo apt install -y certbot python3-certbot-nginx
fi

echo -e "${YELLOW}Getting SSL certificate for $DOMAIN...${NC}"
echo "You'll need to enter your email address when prompted."
sudo certbot --nginx -d $DOMAIN --non-interactive --agree-tos --register-unsafely-without-email || {
    echo -e "${RED}SSL setup failed. You may need to run this manually:${NC}"
    echo "sudo certbot --nginx -d $DOMAIN"
}
echo -e "${GREEN}✓ SSL configured${NC}"

# Step 11: Start Application with PM2
echo -e "${YELLOW}Step 11/12: Starting application...${NC}"
pm2 delete shopify-quiz 2>/dev/null || true
pm2 start npm --name "shopify-quiz" -- run start
pm2 save
pm2 startup | grep "sudo" | bash || true
echo -e "${GREEN}✓ Application started${NC}"

# Step 12: Verify Deployment
echo -e "${YELLOW}Step 12/12: Verifying deployment...${NC}"
sleep 5
if pm2 list | grep -q "shopify-quiz.*online"; then
    echo -e "${GREEN}✓ Application is running!${NC}"
else
    echo -e "${RED}✗ Application failed to start. Check logs: pm2 logs shopify-quiz${NC}"
    exit 1
fi

echo ""
echo -e "${GREEN}🎉 Deployment Complete!${NC}"
echo ""
echo -e "${YELLOW}Next Steps:${NC}"
echo "1. Make sure your DNS A record points to this server:"
echo "   Domain: $DOMAIN"
echo "   IP: $(curl -s ifconfig.me)"
echo ""
echo "2. Update Shopify Partner Dashboard:"
echo "   - Go to: https://partners.shopify.com"
echo "   - Apps → Product Quiz Builder → Configuration"
echo "   - Update App URL to: https://$DOMAIN"
echo "   - Update redirect URLs to use: https://$DOMAIN"
echo ""
echo "3. Deploy to Shopify (run from your Windows machine):"
echo "   cd C:\\Users\\atefm\\Documents\\shopify\\shopify-app"
echo "   npm run deploy"
echo ""
echo -e "${YELLOW}Useful Commands:${NC}"
echo "  pm2 logs shopify-quiz      # View logs"
echo "  pm2 restart shopify-quiz   # Restart app"
echo "  pm2 status                 # Check status"
echo "  sudo systemctl status nginx # Check Nginx"
echo ""
echo "Your app should be accessible at: https://$DOMAIN"
echo ""
