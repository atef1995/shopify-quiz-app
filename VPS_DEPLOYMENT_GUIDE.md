# VPS Deployment Guide
**QuizCraft - Self-Hosted on Your VPS**

Last Updated: October 25, 2025

---

## Why VPS Instead of Fly.io?

**Fly.io Issues:**
- ❌ Auto-suspends apps after inactivity (free tier)
- ❌ Cold starts cause slow first requests
- ❌ Unreliable for production Shopify apps
- ❌ Apps go down randomly when not paid

**Your VPS Benefits:**
- ✅ Always running (no auto-suspend)
- ✅ Full control over server
- ✅ Better performance (no cold starts)
- ✅ More cost-effective long-term
- ✅ Can run multiple apps on same server

---

## Prerequisites

**What You Need:**
- VPS with Ubuntu 20.04+ or similar Linux distro
- Root/sudo access
- Public IP address
- Domain name (or subdomain)

**Recommended VPS Providers:**
- **DigitalOcean** - $6/month droplet (1GB RAM, sufficient for this app)
- **Linode** - $5/month Nanode
- **Vultr** - $6/month instance
- **Hetzner** - €4.51/month CX11 (cheapest in Europe)
- **AWS Lightsail** - $5/month (if you prefer AWS)

**Domain Setup:**
- Option 1: Use subdomain of existing domain (e.g., `quiz.yourdomain.com`)
- Option 2: Buy cheap domain for app (e.g., `productquizbuilder.com` on Namecheap)
- Must NOT contain "shopify" or "example" in domain name

---

## Step 1: VPS Initial Setup

### 1.1 Connect to VPS
```bash
ssh root@your-vps-ip
```

### 1.2 Update System
```bash
apt update && apt upgrade -y
```

### 1.3 Create App User (Security Best Practice)
```bash
adduser shopify-app
usermod -aG sudo shopify-app
su - shopify-app
```

### 1.4 Install Node.js 20
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node --version  # Should show v20.x.x
npm --version
```

### 1.5 Install PostgreSQL
```bash
sudo apt install -y postgresql postgresql-contrib
sudo systemctl start postgresql
sudo systemctl enable postgresql

# Create database and user
sudo -u postgres psql
```

In PostgreSQL shell:
```sql
CREATE DATABASE quiz_builder;
CREATE USER quiz_app WITH PASSWORD 'your-secure-password-here';
GRANT ALL PRIVILEGES ON DATABASE quiz_builder TO quiz_app;
ALTER DATABASE quiz_builder OWNER TO quiz_app;
\q
```

### 1.6 Install Nginx (Reverse Proxy)
```bash
sudo apt install -y nginx
sudo systemctl start nginx
sudo systemctl enable nginx
```

### 1.7 Install Certbot (Free SSL)
```bash
sudo apt install -y certbot python3-certbot-nginx
```

---

## Step 2: Configure Domain

### Option A: Using Your Own Domain

**If you have a domain (e.g., yourdomain.com):**

1. Go to your domain registrar (Namecheap, GoDaddy, Cloudflare, etc.)
2. Add an A record:
   - **Type:** A
   - **Name:** quiz (or whatever subdomain you want)
   - **Value:** Your VPS IP address
   - **TTL:** 300 (5 minutes)

**Result:** `quiz.yourdomain.com` points to your VPS

### Option B: Buy New Domain

**Recommended for cleaner branding:**

1. Go to Namecheap/Porkbun/Cloudflare
2. Search for available domains (avoid "shopify" or "example"):
   - `productquizbuilder.com`
   - `quizbuilderapp.com`
   - `shopquiz.io`
   - `quizforge.app`
3. Buy domain ($5-15/year)
4. Add A record pointing to your VPS IP

**For this guide, let's assume you're using:** `quiz.yourdomain.com`

---

## Step 3: Deploy Application

### 3.1 Clone Repository
```bash
cd /home/shopify-app
git clone https://github.com/atef1995/shopify-quiz-app.git
cd shopify-quiz-app
```

### 3.2 Install Dependencies
```bash
npm install
```

### 3.3 Create Environment File
```bash
nano .env
```

Paste this content (update values):
```env
# Shopify App Credentials (from Partner Dashboard)
SHOPIFY_API_KEY=ccb95c69fbef7812f6a59699510890a1
SHOPIFY_API_SECRET=your-api-secret-here

# Database
DATABASE_URL=postgresql://quiz_app:your-secure-password-here@localhost:5432/quiz_builder

# App URL (your domain)
SHOPIFY_APP_URL=https://quiz.yourdomain.com

# Scopes
SCOPES=write_products,read_products,read_customers,write_customers

# Node Environment
NODE_ENV=production

# Server Port
PORT=3000
HOST=127.0.0.1
```

Save with `Ctrl+X`, then `Y`, then `Enter`.

### 3.4 Update shopify.app.toml

```bash
nano shopify.app.toml
```

Update these lines:
```toml
application_url = "https://quiz.yourdomain.com"

[auth]
redirect_urls = [ 
  "https://quiz.yourdomain.com/auth/login",
  "https://quiz.yourdomain.com/auth/callback",
  "https://quiz.yourdomain.com/api/auth"
]

[app_proxy]
url = "https://quiz.yourdomain.com"
```

### 3.5 Run Database Migrations
```bash
npx prisma generate
npx prisma db push
```

### 3.6 Build Application
```bash
npm run build
```

---

## Step 4: Configure Nginx Reverse Proxy

### 4.1 Create Nginx Config
```bash
sudo nano /etc/nginx/sites-available/shopify-quiz-app
```

Paste this:
```nginx
server {
    listen 80;
    server_name quiz.yourdomain.com;

    # Redirect HTTP to HTTPS (after SSL is set up)
    # return 301 https://$server_name$request_uri;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;

        # Increase timeouts for long requests
        proxy_connect_timeout 600;
        proxy_send_timeout 600;
        proxy_read_timeout 600;
        send_timeout 600;
    }

    # Increase max body size for uploads
    client_max_body_size 10M;
}
```

Save and exit.

### 4.2 Enable Site
```bash
sudo ln -s /etc/nginx/sites-available/shopify-quiz-app /etc/nginx/sites-enabled/
sudo nginx -t  # Test configuration
sudo systemctl reload nginx
```

---

## Step 5: Setup SSL Certificate (HTTPS)

### 5.1 Get Free SSL from Let's Encrypt
```bash
sudo certbot --nginx -d quiz.yourdomain.com
```

**Follow prompts:**
1. Enter email: `your-email@example.com`
2. Agree to terms: `Y`
3. Share email with EFF: `N` (optional)
4. Redirect HTTP to HTTPS: `2` (recommended)

**Result:** Your site now has HTTPS! 🎉

### 5.2 Auto-Renewal Setup (Already Configured)
```bash
# Test renewal
sudo certbot renew --dry-run

# Certbot auto-renews via systemd timer
sudo systemctl status certbot.timer
```

---

## Step 6: Setup PM2 Process Manager

### 6.1 Install PM2
```bash
sudo npm install -g pm2
```

### 6.2 Start Application
```bash
cd /home/shopify-app/shopify-quiz-app
pm2 start npm --name "shopify-quiz-app" -- run start
```

### 6.3 Configure Auto-Start on Reboot
```bash
pm2 startup
# Copy and run the command it shows

pm2 save
```

### 6.4 Monitor Application
```bash
# View logs
pm2 logs shopify-quiz-app

# View status
pm2 status

# Restart if needed
pm2 restart shopify-quiz-app

# Stop
pm2 stop shopify-quiz-app
```

---

## Step 7: Update Shopify Partner Dashboard

### 7.1 Update App URLs

1. Go to: https://partners.shopify.com
2. Navigate to: Apps → QuizCraft → Configuration
3. Update **App URL:** `https://quiz.yourdomain.com`
4. Update **Allowed redirection URL(s):**
   - `https://quiz.yourdomain.com/auth/login`
   - `https://quiz.yourdomain.com/auth/callback`
   - `https://quiz.yourdomain.com/api/auth`
5. Click **Save**

### 7.2 Deploy to Shopify
```bash
cd /home/shopify-app/shopify-quiz-app
npm run deploy
```

This registers webhooks and syncs configuration.

---

## Step 8: Test Deployment

### 8.1 Test HTTPS
```bash
curl -I https://quiz.yourdomain.com
```

Should return `200 OK` with HTTPS.

### 8.2 Install on Development Store

1. Partner Dashboard → Apps → QuizCraft → Test your app
2. Select development store
3. Click "Install app"
4. Should redirect to quiz dashboard
5. Create a test quiz
6. Publish quiz
7. Add quiz block to storefront
8. Complete quiz as customer
9. Verify results are saved

---

## Step 9: Monitoring & Maintenance

### 9.1 Check App Status
```bash
pm2 status
pm2 logs shopify-quiz-app --lines 50
```

### 9.2 Check Nginx Status
```bash
sudo systemctl status nginx
sudo tail -f /var/log/nginx/access.log
sudo tail -f /var/log/nginx/error.log
```

### 9.3 Check Database
```bash
sudo -u postgres psql quiz_builder
\dt  # List tables
SELECT COUNT(*) FROM "Quiz";
\q
```

### 9.4 Restart Services (If Needed)
```bash
# Restart app
pm2 restart shopify-quiz-app

# Restart nginx
sudo systemctl restart nginx

# Restart PostgreSQL
sudo systemctl restart postgresql
```

---

## Step 10: Database Backups (Important!)

### 10.1 Manual Backup
```bash
sudo -u postgres pg_dump quiz_builder > ~/backup-$(date +%Y%m%d).sql
```

### 10.2 Automated Daily Backups
```bash
# Create backup script
nano ~/backup-db.sh
```

Paste:
```bash
#!/bin/bash
BACKUP_DIR="/home/shopify-app/backups"
mkdir -p $BACKUP_DIR
sudo -u postgres pg_dump quiz_builder > $BACKUP_DIR/quiz_builder_$(date +\%Y\%m\%d_\%H\%M).sql
# Keep only last 7 days
find $BACKUP_DIR -name "quiz_builder_*.sql" -mtime +7 -delete
```

Make executable and add to cron:
```bash
chmod +x ~/backup-db.sh
crontab -e
```

Add this line (runs daily at 2 AM):
```
0 2 * * * /home/shopify-app/backup-db.sh
```

### 10.3 Restore from Backup
```bash
sudo -u postgres psql quiz_builder < ~/backup-20251025.sql
```

---

## Step 11: Updating Application

### 11.1 Pull Latest Code
```bash
cd /home/shopify-app/shopify-quiz-app
git pull origin main
```

### 11.2 Install Dependencies
```bash
npm install
```

### 11.3 Run Migrations
```bash
npx prisma generate
npx prisma db push
```

### 11.4 Rebuild
```bash
npm run build
```

### 11.5 Restart App
```bash
pm2 restart shopify-quiz-app
```

---

## Troubleshooting

### App Won't Start
```bash
# Check logs
pm2 logs shopify-quiz-app

# Check if port 3000 is in use
sudo netstat -tulpn | grep 3000

# Restart app
pm2 restart shopify-quiz-app
```

### Nginx Errors
```bash
# Test config
sudo nginx -t

# Check error logs
sudo tail -f /var/log/nginx/error.log

# Restart nginx
sudo systemctl restart nginx
```

### Database Connection Errors
```bash
# Check if PostgreSQL is running
sudo systemctl status postgresql

# Test connection
psql -h localhost -U quiz_app -d quiz_builder

# Check DATABASE_URL in .env matches database credentials
```

### SSL Certificate Issues
```bash
# Renew certificate
sudo certbot renew

# Check certificate status
sudo certbot certificates
```

---

## Cost Breakdown

### Monthly Costs:
- **VPS:** $5-6/month (DigitalOcean/Linode/Vultr)
- **Domain:** ~$1/month ($10-15/year)
- **SSL:** $0 (Let's Encrypt is free)
- **Total:** **~$6-7/month**

**vs. Fly.io paid tier:** $12-20/month (with similar specs)

**Savings:** ~50% cheaper + no auto-suspend issues!

---

## Security Checklist

- [ ] Firewall configured (UFW):
  ```bash
  sudo ufw allow 22    # SSH
  sudo ufw allow 80    # HTTP
  sudo ufw allow 443   # HTTPS
  sudo ufw enable
  ```
- [ ] SSH key authentication (disable password login)
- [ ] Regular system updates: `sudo apt update && sudo apt upgrade`
- [ ] Database passwords are strong and unique
- [ ] `.env` file has correct permissions: `chmod 600 .env`
- [ ] Fail2ban installed: `sudo apt install fail2ban`
- [ ] Regular backups configured (see Step 10)

---

## Performance Tips

### Enable Gzip Compression
Add to nginx config:
```nginx
gzip on;
gzip_types text/plain text/css application/json application/javascript text/xml application/xml;
```

### Enable Caching
Add to nginx location block:
```nginx
location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg)$ {
    expires 1y;
    add_header Cache-Control "public, immutable";
}
```

### Monitor Server Resources
```bash
# Install htop
sudo apt install htop
htop

# Check disk space
df -h

# Check memory
free -h
```

---

## Next Steps

After deployment is working:

1. ✅ Verify app is accessible at your domain
2. ✅ Test OAuth flow works
3. ✅ Install on development store
4. ✅ Complete full quiz creation → completion flow
5. ✅ Update `APP_STORE_SUBMISSION_GUIDE.md` with your domain
6. ✅ Submit app to Shopify App Store
7. ✅ Set up monitoring (optional: UptimeRobot for free uptime alerts)

---

**Your app is now running 24/7 on your own VPS! 🎉**

No more auto-suspend issues. Full control. Better performance.
