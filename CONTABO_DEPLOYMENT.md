# Contabo VPS Deployment Guide
**QuizCraft - Deploy to Existing Contabo Server**

Last Updated: October 25, 2025

---

## Pre-Deployment Checklist

**Information Needed:**
- [ ] VPS IP Address: `___________________`
- [ ] Domain/Subdomain: `___________________` (e.g., quiz.yourdomain.com)
- [ ] SSH Username: `___________________` (root or sudo user)
- [ ] SSH Password/Key: Available
- [ ] Existing websites: Yes (already running another site)

**What We'll Set Up:**
- App runs on port **3001** (to avoid conflict with existing site)
- Separate Nginx virtual host
- Shared PostgreSQL database (new database for quiz app)
- PM2 process manager for both apps
- Separate SSL certificate for quiz subdomain

---

## Step 1: Connect to Your VPS

```powershell
# From your Windows machine
ssh root@YOUR_VPS_IP
# Or if you have a user account:
# ssh username@YOUR_VPS_IP
```

**Replace YOUR_VPS_IP with actual IP**

---

## Step 2: Check What's Already Installed

```bash
# Check Node.js version
node --version
# If not installed or < v18, we'll upgrade

# Check if PostgreSQL is installed
psql --version
# If not installed, we'll install it

# Check if Nginx is installed
nginx -v
# Should already be installed since you have another site

# Check if PM2 is installed
pm2 --version
# If not, we'll install it

# Check existing PM2 processes
pm2 list
# Shows what's currently running
```

**Send me the output of these commands so I can tailor the instructions.**

---

## Step 3: Install Missing Dependencies

### 3.1 Update Node.js (if needed)

**If Node.js is < v18 or not installed:**

```bash
# Remove old Node.js (if exists)
sudo apt remove nodejs -y

# Install Node.js 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Verify
node --version  # Should show v20.x.x
npm --version
```

### 3.2 Install PostgreSQL (if not installed)

```bash
# Install PostgreSQL
sudo apt update
sudo apt install -y postgresql postgresql-contrib

# Start and enable
sudo systemctl start postgresql
sudo systemctl enable postgresql

# Verify
sudo systemctl status postgresql
```

### 3.3 Install PM2 (if not installed)

```bash
sudo npm install -g pm2

# If you have existing apps running, they'll continue running
pm2 list
```

### 3.4 Nginx Should Already Be Installed

```bash
# Check nginx status
sudo systemctl status nginx

# If not running, start it
sudo systemctl start nginx
sudo systemctl enable nginx
```

---

## Step 4: Create Database

```bash
# Switch to postgres user
sudo -u postgres psql
```

**In PostgreSQL shell, run:**

```sql
-- Create database for quiz app
CREATE DATABASE shopify_quiz_builder;

-- Create user with strong password
CREATE USER quiz_app WITH PASSWORD 'CHANGE_THIS_TO_SECURE_PASSWORD';

-- Grant privileges
GRANT ALL PRIVILEGES ON DATABASE shopify_quiz_builder TO quiz_app;
ALTER DATABASE shopify_quiz_builder OWNER TO quiz_app;

-- Exit
\q
```

**Save the password you used - you'll need it in .env file**

---

## Step 5: Clone and Setup Application

```bash
# Navigate to a good location (e.g., /var/www or /home)
cd /var/www

# Clone repository
sudo git clone https://github.com/atef1995/shopify-quiz-app.git

# If git not installed:
# sudo apt install git -y
# Then try again

# Change ownership to your user (replace 'youruser' with actual username)
sudo chown -R $USER:$USER shopify-quiz-app

# Enter directory
cd shopify-quiz-app

# Install dependencies
npm install
```

---

## Step 6: Configure Environment Variables

```bash
# Create .env file
nano .env
```

**Paste this configuration (UPDATE the values):**

```env
# Shopify App Credentials
SHOPIFY_API_KEY=ccb95c69fbef7812f6a59699510890a1
SHOPIFY_API_SECRET=YOUR_API_SECRET_HERE

# Database Connection
DATABASE_URL=postgresql://quiz_app:CHANGE_THIS_TO_SECURE_PASSWORD@localhost:5432/shopify_quiz_builder

# App URL (your domain - UPDATE THIS)
SHOPIFY_APP_URL=https://quiz.yourdomain.com

# Scopes
SCOPES=write_products,read_products,read_customers,write_customers

# Node Environment
NODE_ENV=production

# Server Configuration
PORT=3001
HOST=127.0.0.1
```

**Important:**
- Replace `YOUR_API_SECRET_HERE` with your actual Shopify API secret
- Replace `CHANGE_THIS_TO_SECURE_PASSWORD` with the database password you set in Step 4
- Replace `quiz.yourdomain.com` with your actual domain/subdomain
- **PORT=3001** (different from your existing site which is probably on 3000)

**Save:** Press `Ctrl+X`, then `Y`, then `Enter`

**Secure the file:**
```bash
chmod 600 .env
```

---

## Step 7: Update shopify.app.toml

```bash
nano shopify.app.toml
```

**Update these lines (use your actual domain):**

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

**Save:** `Ctrl+X`, `Y`, `Enter`

---

## Step 8: Build Application

```bash
# Generate Prisma client
npx prisma generate

# Push database schema
npx prisma db push

# Build the app
npm run build

# This will take a few minutes...
```

---

## Step 9: Configure Nginx Virtual Host

```bash
# Create new Nginx config for quiz app
sudo nano /etc/nginx/sites-available/shopify-quiz-app
```

**Paste this configuration:**

```nginx
server {
    listen 80;
    server_name quiz.yourdomain.com;  # UPDATE THIS

    # HTTP will redirect to HTTPS after SSL setup
    location / {
        proxy_pass http://127.0.0.1:3001;  # Note: port 3001, not 3000
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;

        # Timeouts for long requests
        proxy_connect_timeout 600;
        proxy_send_timeout 600;
        proxy_read_timeout 600;
        send_timeout 600;
    }

    # Max upload size
    client_max_body_size 10M;
}
```

**Replace `quiz.yourdomain.com` with your actual subdomain**

**Save:** `Ctrl+X`, `Y`, `Enter`

### Enable the site:

```bash
# Create symlink to enable site
sudo ln -s /etc/nginx/sites-available/shopify-quiz-app /etc/nginx/sites-enabled/

# Test Nginx configuration
sudo nginx -t

# If test passes, reload Nginx
sudo systemctl reload nginx
```

---

## Step 10: Configure Domain DNS

**Before SSL will work, you need to point your domain to the VPS:**

1. Go to your domain registrar (Namecheap, GoDaddy, Cloudflare, etc.)
2. Add DNS A record:
   - **Type:** A
   - **Name:** quiz (or your chosen subdomain)
   - **Value:** YOUR_VPS_IP
   - **TTL:** 300 (5 minutes)

3. Wait for DNS propagation (5-30 minutes)

**Test DNS:**
```bash
# From your Windows machine
nslookup quiz.yourdomain.com
# Should return your VPS IP
```

---

## Step 11: Setup SSL Certificate

**Once DNS is pointing to your VPS:**

```bash
# Install Certbot (if not already installed)
sudo apt install -y certbot python3-certbot-nginx

# Get SSL certificate for your subdomain
sudo certbot --nginx -d quiz.yourdomain.com
```

**Follow the prompts:**
1. Enter email address
2. Agree to terms: `Y`
3. Share email with EFF: `N` (optional)
4. Redirect HTTP to HTTPS: `2` (Yes, recommended)

**Certbot will:**
- Get free SSL certificate from Let's Encrypt
- Automatically configure Nginx for HTTPS
- Set up auto-renewal

**Test auto-renewal:**
```bash
sudo certbot renew --dry-run
```

---

## Step 12: Start Application with PM2

```bash
cd /var/www/shopify-quiz-app

# Start app with PM2
pm2 start npm --name "shopify-quiz" -- run start

# Save PM2 process list
pm2 save

# Setup PM2 to start on boot (if not already done)
pm2 startup
# Copy and run the command it shows

# Check status
pm2 list
# You should see both your existing app(s) and "shopify-quiz"
```

**PM2 commands you'll need:**
```bash
pm2 list              # Show all running apps
pm2 logs shopify-quiz # View logs
pm2 restart shopify-quiz  # Restart app
pm2 stop shopify-quiz     # Stop app
pm2 delete shopify-quiz   # Remove from PM2
```

---

## Step 13: Test Deployment

### 13.1 Test HTTPS Access

```bash
# From VPS or your local machine
curl -I https://quiz.yourdomain.com
# Should return: HTTP/2 200 (or HTTP/1.1 200)
```

### 13.2 Check App is Running

```bash
pm2 status
# shopify-quiz should show "online" status

pm2 logs shopify-quiz --lines 20
# Should show app started successfully
```

### 13.3 Check Nginx

```bash
sudo nginx -t  # Test config
sudo systemctl status nginx  # Should be active (running)
```

---

## Step 14: Update Shopify Partner Dashboard

### 14.1 Update URLs in Partner Dashboard

1. Go to: https://partners.shopify.com
2. Navigate to: **Apps → QuizCraft → Configuration**
3. Update **App URL:** `https://quiz.yourdomain.com`
4. Update **Allowed redirection URL(s):**
   - `https://quiz.yourdomain.com/auth/login`
   - `https://quiz.yourdomain.com/auth/callback`
   - `https://quiz.yourdomain.com/api/auth`
5. Click **Save**

### 14.2 Deploy to Shopify (Register Webhooks)

**From your Windows machine (in project directory):**

```powershell
cd C:\Users\atefm\Documents\shopify\shopify-app
npm run deploy
```

This will sync your configuration and register webhooks.

---

## Step 15: Test Full Installation

### 15.1 Install on Development Store

1. Partner Dashboard → Apps → QuizCraft
2. Click "Select store" → Choose your development store
3. Click "Install app"
4. Should redirect through OAuth flow
5. Should land on quiz dashboard

### 15.2 Create Test Quiz

1. Click "Create Quiz"
2. Add title: "Test Quiz"
3. Add questions and options
4. Save quiz
5. Activate quiz

### 15.3 Test on Storefront

1. Go to Shopify admin → Online Store → Themes → Customize
2. Add quiz block to a page
3. Enter quiz ID
4. Save
5. View storefront page
6. Complete quiz
7. Verify recommendations show

### 15.4 Verify Data Saved

```bash
# On VPS, check database
sudo -u postgres psql shopify_quiz_builder

# Check quizzes
SELECT id, title, status FROM "Quiz";

# Check results
SELECT COUNT(*) FROM "QuizResult";

# Exit
\q
```

---

## Monitoring & Maintenance

### Check App Status
```bash
pm2 status
pm2 logs shopify-quiz --lines 50
```

### Check Nginx Logs
```bash
sudo tail -f /var/log/nginx/access.log
sudo tail -f /var/log/nginx/error.log
```

### Restart Services
```bash
# Restart app
pm2 restart shopify-quiz

# Restart nginx
sudo systemctl restart nginx

# Restart PostgreSQL
sudo systemctl restart postgresql
```

### Update Application
```bash
cd /var/www/shopify-quiz-app
git pull origin main
npm install
npx prisma generate
npx prisma db push
npm run build
pm2 restart shopify-quiz
```

---

## Troubleshooting

### Port 3001 Already in Use
```bash
# Check what's using port 3001
sudo netstat -tulpn | grep 3001

# Kill the process or change PORT in .env to 3002, 3003, etc.
```

### App Won't Start
```bash
pm2 logs shopify-quiz --lines 100
# Check for error messages

# Common issues:
# - Database connection (check DATABASE_URL in .env)
# - Port already in use (change PORT in .env)
# - Missing dependencies (run npm install again)
```

### Nginx 502 Bad Gateway
```bash
# Check if app is running
pm2 status

# Check Nginx error log
sudo tail -f /var/log/nginx/error.log

# Make sure app is running on correct port (3001)
curl http://localhost:3001
```

### Database Connection Error
```bash
# Test database connection
psql -h localhost -U quiz_app -d shopify_quiz_builder
# Enter the password you set

# If connection fails:
# - Check PostgreSQL is running: sudo systemctl status postgresql
# - Check DATABASE_URL in .env matches credentials
# - Check firewall: sudo ufw status
```

---

## Security Notes

**Since you have an existing site, these might already be configured:**

- ✅ Firewall (UFW) should already allow ports 22, 80, 443
- ✅ SSH should already be secured
- ✅ Fail2ban might already be installed
- ✅ Regular updates: `sudo apt update && sudo apt upgrade`

**New security considerations:**
- `.env` file permissions: `chmod 600 /var/www/shopify-quiz-app/.env`
- Database password should be strong and unique
- Regular backups (see below)

---

## Backup Database

### Manual Backup
```bash
sudo -u postgres pg_dump shopify_quiz_builder > ~/quiz-backup-$(date +%Y%m%d).sql
```

### Automated Daily Backups
```bash
# Create backup script
nano ~/backup-quiz.sh
```

Paste:
```bash
#!/bin/bash
BACKUP_DIR="/home/$(whoami)/backups/quiz"
mkdir -p $BACKUP_DIR
sudo -u postgres pg_dump shopify_quiz_builder > $BACKUP_DIR/quiz_$(date +\%Y\%m\%d_\%H\%M).sql
# Keep only last 7 days
find $BACKUP_DIR -name "quiz_*.sql" -mtime +7 -delete
```

Make executable and schedule:
```bash
chmod +x ~/backup-quiz.sh
crontab -e
# Add this line (runs daily at 3 AM):
0 3 * * * /home/$(whoami)/backup-quiz.sh
```

---

## Resource Usage

**Your Contabo VPS should handle both sites fine if specs are:**
- RAM: 4GB+ (2GB minimum)
- CPU: 2+ cores
- Disk: 50GB+

**Check current usage:**
```bash
# Memory
free -h

# Disk
df -h

# CPU
top
# Press 'q' to quit
```

**If you notice high resource usage:**
- Consider upgrading Contabo plan
- Optimize database queries
- Add caching (Redis)

---

## Cost

**No additional cost!** You're already paying for Contabo VPS.

**Only potential costs:**
- Domain (if buying new): $10-15/year
- SSL: $0 (Let's Encrypt is free)

---

## Next Steps After Deployment

1. ✅ Test app thoroughly on development store
2. ✅ Complete App Store submission (use APP_STORE_SUBMISSION_GUIDE.md)
3. ✅ Set up monitoring (optional: UptimeRobot for free uptime checks)
4. ✅ Create backups schedule
5. ✅ Document your custom domain for future reference

---

## Quick Reference

**App Location:** `/var/www/shopify-quiz-app`
**Config File:** `/var/www/shopify-quiz-app/.env`
**Nginx Config:** `/etc/nginx/sites-available/shopify-quiz-app`
**Database:** `shopify_quiz_builder`
**Port:** `3001`
**PM2 Process:** `shopify-quiz`
**Domain:** `https://quiz.yourdomain.com` (your actual domain)

---

**Ready to deploy! Just provide your VPS IP and domain, and we'll get started! 🚀**
