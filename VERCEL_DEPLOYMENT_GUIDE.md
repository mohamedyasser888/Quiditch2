# 🚀 VERCEL DEPLOYMENT GUIDE

## ✅ PRE-DEPLOYMENT CHECKLIST

### Build Status
- [x] **Build passes locally** (`npm run build`)
- [x] **TypeScript compiles** without errors
- [x] **No console errors** in production mode
- [x] **All features tested** and working
- [x] **Code pushed to GitHub** (https://github.com/mohamedyasser888/quid-final)

### Configuration Files
- [x] `package.json` - ✅ Valid, Node 20+, npm 10+
- [x] `next.config.ts` - ✅ Optimized with security headers
- [x] `vercel.json` - ✅ Caching and security configured
- [x] `.env.example` - ✅ Template provided
- [x] `.gitignore` - ✅ Excludes `.env.local`

---

## 📋 DEPLOYMENT STEPS

### Step 1: Prepare Supabase

1. **Go to your Supabase project dashboard**
   - URL: https://supabase.com/dashboard/project/YOUR_PROJECT_ID

2. **Get your credentials:**
   - Go to **Settings** → **API**
   - Copy:
     - `Project URL` (e.g., https://abcdefgh.supabase.co)
     - `anon/public` key (starts with `eyJ...`)
     - `service_role` key (starts with `eyJ...`) - **KEEP SECRET**

3. **Run database migrations:**
   ```bash
   # If not already done
   cd supabase/migrations
   # Apply each migration in order (001 through 023)
   ```

4. **Enable Realtime:**
   - Go to **Database** → **Replication**
   - Enable replication for tables: `rooms`, `teams`, `team_members`
   - Go to **Database** → **Publications**
   - Ensure `supabase_realtime` publication includes these tables

5. **Set up RLS policies:**
   - All migrations include RLS policies
   - Verify in **Authentication** → **Policies**

---

### Step 2: Deploy to Vercel

#### Option A: Deploy via Vercel Dashboard (Recommended)

1. **Go to Vercel:** https://vercel.com/new

2. **Import Git Repository:**
   - Click "Add New" → "Project"
   - Select GitHub
   - Search for: `mohamedyasser888/quid-final`
   - Click "Import"

3. **Configure Project:**
   - **Framework Preset:** Next.js (auto-detected)
   - **Root Directory:** `./` (leave as is)
   - **Build Command:** `npm run build` (default)
   - **Output Directory:** `.next` (default)
   - **Install Command:** `npm install` (default)
   - **Node Version:** 20.x (auto-detected from package.json)

4. **Add Environment Variables:**
   
   Click "Environment Variables" and add:

   ```
   NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_ID.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJ...YOUR_ANON_KEY
   SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJ...YOUR_SERVICE_KEY
   ```

   **Important:**
   - ✅ Apply to: **Production, Preview, and Development**
   - ✅ Double-check there are NO extra spaces
   - ✅ URLs must start with `https://`
   - ✅ Keys must start with `eyJ` or `sbp_`

5. **Deploy:**
   - Click "Deploy"
   - Wait 2-3 minutes for build to complete
   - ✅ You'll see "Your project has been successfully deployed"

---

#### Option B: Deploy via Vercel CLI

```bash
# Install Vercel CLI
npm install -g vercel

# Login to Vercel
vercel login

# Deploy
cd d:\quiditch
vercel

# Follow prompts:
# - Link to existing project? No
# - What's your project's name? quid-final
# - In which directory is your code located? ./
# - Want to modify settings? No

# Add environment variables
vercel env add NEXT_PUBLIC_SUPABASE_URL production
# Paste: https://YOUR_PROJECT_ID.supabase.co

vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY production
# Paste: eyJhbGciOiJ...

vercel env add SUPABASE_SERVICE_ROLE_KEY production
# Paste: eyJhbGciOiJ...

# Deploy to production
vercel --prod
```

---

### Step 3: Configure Domain (Optional)

1. **In Vercel Dashboard:**
   - Go to your project
   - Click "Settings" → "Domains"
   - Add your custom domain (e.g., `quiditch.yourdomain.com`)
   - Follow DNS configuration instructions

2. **Update Supabase allowed domains:**
   - Go to Supabase → **Authentication** → **URL Configuration**
   - Add Vercel domain to **Site URL** and **Redirect URLs**:
     - `https://your-project.vercel.app`
     - `https://your-custom-domain.com` (if using custom domain)

---

### Step 4: Post-Deployment Verification

#### ✅ Check Build Logs
1. In Vercel dashboard, click "Deployments"
2. Click latest deployment
3. Check "Build Logs" - should show:
   ```
   ✅ All required environment variables are set
   ✅ Environment validation passed
   ✓ Compiled successfully
   ✓ Finished TypeScript
   ✓ Generating static pages
   ```

#### ✅ Test Features

1. **Homepage:** https://your-project.vercel.app
   - Should load without errors
   - Check console for errors (F12)

2. **Authentication:**
   - Click "Login" → Register new account
   - Should receive email confirmation
   - Login should work

3. **Room Creation:**
   - Create a new room
   - Should generate room code (e.g., ABCD-1234)
   - Room lobby should load

4. **Coin Flip:**
   - Open two browser windows
   - Both join the same room
   - Both click "Ready"
   - **Verify:** Coin flip animation appears
   - **Verify:** Both players see same result

5. **Game:**
   - Deploy pieces
   - **Verify:** No coin flip after deployment
   - Move pieces
   - **Verify:** Turn switches to other team
   - Move seeker to snitch
   - **Verify:** Wheel appears after full turn (2 moves)

6. **Realtime:**
   - Make moves in window 1
   - **Verify:** Window 2 updates immediately
   - Check for sync issues

---

## 🔧 TROUBLESHOOTING

### Build Fails

#### Error: "Missing environment variables"
**Solution:**
1. Check Vercel dashboard → Settings → Environment Variables
2. Verify all 3 variables are set
3. Redeploy: `vercel --prod` or click "Redeploy" in dashboard

#### Error: "Module not found"
**Solution:**
```bash
# Clear cache and reinstall
rm -rf node_modules .next
npm install
npm run build
```

#### Error: "TypeScript compilation failed"
**Solution:**
```bash
# Check for errors locally
npm run type-check

# Fix any errors, then push to GitHub
git add .
git commit -m "Fix TypeScript errors"
git push
```

---

### Runtime Errors

#### Error: "Failed to fetch from Supabase"
**Symptoms:** Login doesn't work, rooms don't load
**Solution:**
1. Check Supabase project is running (not paused)
2. Verify environment variables are correct
3. Check Supabase dashboard for API errors
4. Ensure RLS policies are enabled

#### Error: "Realtime connection failed"
**Symptoms:** Players don't see each other's moves
**Solution:**
1. Go to Supabase → Database → Replication
2. Enable replication for: `rooms`, `teams`, `team_members`
3. Check realtime logs in Supabase dashboard
4. Verify WebSocket connections aren't blocked

#### Error: "Coin flip doesn't appear"
**Symptoms:** Room lobby doesn't show coin flip
**Solution:**
1. Hard refresh browser: `Ctrl + Shift + R`
2. Check console for JavaScript errors
3. Verify `coinFlipResult` state is being set
4. Check network tab for failed requests

#### Error: "Turn doesn't switch"
**Symptoms:** Player can move multiple times
**Solution:**
1. Check `turn` state in React DevTools
2. Verify `finishMatchTurn` is being called
3. Check for console errors after move
4. Ensure realtime is syncing properly

---

## 📊 MONITORING

### Vercel Analytics (Built-in)
- **Page views:** See which pages are most popular
- **Performance:** Monitor loading times
- **Errors:** Track client-side errors
- **Location:** Dashboard → Analytics

### Supabase Monitoring
- **API Usage:** Dashboard → Settings → Usage
- **Database Performance:** Dashboard → Database → Query Performance
- **Realtime Connections:** Dashboard → Database → Replication
- **Auth Activity:** Dashboard → Authentication → Logs

---

## 🔐 SECURITY CHECKLIST

- [x] **Environment variables** not committed to Git
- [x] **Service role key** only used server-side
- [x] **HTTPS** enforced (Vercel default)
- [x] **Security headers** configured in next.config.ts
- [x] **RLS policies** enabled on all tables
- [x] **CORS** configured in Supabase
- [x] **Rate limiting** via Supabase (default)

---

## 🚀 PERFORMANCE OPTIMIZATIONS

### Already Configured
- [x] **Image optimization** (WebP, AVIF formats)
- [x] **Static generation** for pages
- [x] **Code splitting** (automatic)
- [x] **Compression** enabled
- [x] **Caching headers** for static assets
- [x] **Bundle optimization** (remove console.logs in prod)
- [x] **Turbopack bundler** (Next.js 16 default)

### Vercel Automatic Features
- ✅ **Edge Network** (CDN)
- ✅ **Automatic HTTPS**
- ✅ **Brotli compression**
- ✅ **HTTP/2 & HTTP/3**
- ✅ **Automatic failover**

---

## 📦 DEPLOYMENT COMMANDS

```bash
# Build locally to test
npm run build

# Start production server locally
npm run start

# Deploy to Vercel (production)
vercel --prod

# Deploy preview (staging)
vercel

# Check deployment status
vercel ls

# View logs
vercel logs your-deployment-url

# Rollback to previous deployment
vercel rollback
```

---

## 🌍 CUSTOM DOMAIN SETUP

### 1. Add Domain in Vercel
```
Settings → Domains → Add Domain
Enter: quiditch.yourdomain.com
```

### 2. Configure DNS
Add these records at your domain provider:

**Option A: CNAME (Recommended)**
```
Type: CNAME
Name: quiditch (or @ for root)
Value: cname.vercel-dns.com
TTL: 3600
```

**Option B: A Record**
```
Type: A
Name: quiditch (or @ for root)
Value: 76.76.21.21
TTL: 3600
```

### 3. Wait for DNS Propagation
- Usually takes 5-60 minutes
- Check status: https://www.whatsmydns.net

### 4. Enable SSL
- Vercel automatically provisions SSL certificate
- Force HTTPS in Vercel settings

---

## ✅ FINAL CHECKLIST

Before marking deployment as complete:

- [ ] Site loads at Vercel URL
- [ ] No build errors in logs
- [ ] Environment variables set correctly
- [ ] Login/Registration works
- [ ] Room creation works
- [ ] Coin flip appears in lobby
- [ ] Coin flip does NOT appear after deployment
- [ ] Turn switches after moves
- [ ] Snitch wheel triggers after full turn
- [ ] Realtime updates work (2 windows)
- [ ] No console errors (F12)
- [ ] Mobile responsive (test on phone)
- [ ] Custom domain configured (if applicable)
- [ ] SSL certificate active
- [ ] Monitoring enabled

---

## 🎉 SUCCESS!

Your Quidditch Academy game is now live on Vercel!

**Share your deployment:**
- Production URL: `https://your-project.vercel.app`
- Custom Domain: `https://quiditch.yourdomain.com`

**Next Steps:**
1. Share the link with players
2. Monitor analytics and errors
3. Gather feedback
4. Deploy updates as needed

---

## 📞 SUPPORT

### Vercel Support
- Docs: https://vercel.com/docs
- Support: https://vercel.com/support
- Status: https://www.vercel-status.com

### Supabase Support
- Docs: https://supabase.com/docs
- Support: https://supabase.com/support
- Status: https://status.supabase.com

### GitHub Issues
- Report bugs: https://github.com/mohamedyasser888/quid-final/issues

---

**Deployment Guide Version:** 1.0  
**Last Updated:** January 16, 2025  
**Status:** ✅ READY FOR DEPLOYMENT
