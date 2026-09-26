# 🔄 CACHE BUSTING & DEPLOYMENT GUIDE

## 🎯 Problem: Yellow Attacker Bug After Deployment

**Issue:** Yellow team attacker moves back 2 blocks BEFORE shooting (only after Vercel deployment, works fine locally)

**Root Cause:** Browser cache or Vercel build cache serving stale JavaScript

---

## ✅ IMPLEMENTED FIXES

### 1. Unique Build IDs (Cache Busting)
**File:** `next.config.ts`
```typescript
generateBuildId: async () => {
  return `build-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
}
```
- Every build gets a unique ID
- Forces browsers to download new JavaScript bundles
- Prevents stale code from being cached

### 2. No-Cache Headers for Game Page
**File:** `next.config.ts`
```typescript
{
  source: '/game/:roomCode*',
  headers: [
    { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
    { key: 'Pragma', value: 'no-cache' },
    { key: 'Expires', value: '0' }
  ]
}
```
- Game page HTML is never cached
- Always fetches fresh content from server
- Prevents old game logic from running

### 3. Version Bump
**File:** `package.json`
```json
"version": "0.1.1"
```
- Changed from 0.1.0 → 0.1.1
- Signals to Vercel this is a new version
- May trigger cache invalidation

### 4. Build Timestamp Environment Variable
**File:** `vercel.json`
```json
"env": {
  "BUILD_TIMESTAMP": "@now"
}
```
- Adds timestamp to build environment
- Helps track which build is deployed
- Can be used for version display

---

## 🚀 DEPLOYMENT INSTRUCTIONS

### Step 1: Clear Vercel Cache (IMPORTANT!)

**Option A: Via Vercel Dashboard**
1. Go to https://vercel.com
2. Select your project
3. Settings → Data Cache
4. Click "Purge Everything"
5. Confirm

**Option B: Via Vercel CLI**
```bash
npm install -g vercel
vercel login
vercel cache clean
```

### Step 2: Deploy New Version
```bash
git add .
git commit -m "🐛 Fix cache busting for yellow attacker bug"
git push origin main
```

### Step 3: Verify Deployment
1. Wait for Vercel deployment to complete
2. Check deployment URL
3. Open browser in **Incognito/Private mode**
4. Hard refresh: `Ctrl + Shift + R` (Windows) or `Cmd + Shift + R` (Mac)

### Step 4: Test Yellow Team
1. Create a new match
2. Join as Yellow team (team 2)
3. Deploy attacker to row 1 (goal zone)
4. Click "SHOOT GOAL"
5. **Verify:** Attacker stays in row 1 until AFTER duel completes
6. **Verify:** Attacker resets to row 3 AFTER duel, not before

---

## 🧪 TESTING CHECKLIST

### Before Deployment
- [x] Build passes locally: `npm run build`
- [x] Broom speed 4 button visible
- [x] Cache busting implemented
- [x] Version bumped

### After Deployment
- [ ] Hard refresh in incognito mode
- [ ] Test Purple team attacker (should work)
- [ ] Test Yellow team attacker (should be fixed)
- [ ] Verify attacker stays in goal zone during duel
- [ ] Verify attacker resets AFTER duel completes
- [ ] Test on mobile device
- [ ] Test on different browsers (Chrome, Firefox, Safari)

---

## 🔍 DEBUGGING CACHE ISSUES

### If Yellow Attacker Bug Still Happens:

#### 1. Check Browser Cache
```
1. Open DevTools (F12)
2. Go to Network tab
3. Check "Disable cache"
4. Hard refresh (Ctrl + Shift + R)
5. Test again
```

#### 2. Check Vercel Build ID
```
1. View page source
2. Find: <script src="/_next/static/[BUILD_ID]/..."
3. Note the BUILD_ID
4. Refresh page
5. Verify BUILD_ID changed (should be different on each deployment)
```

#### 3. Check Cache Headers
```
1. Open DevTools → Network tab
2. Navigate to game page
3. Find document request
4. Check Response Headers:
   - Cache-Control: no-cache, no-store, must-revalidate
   - Pragma: no-cache
   - Expires: 0
```

#### 4. Clear All Caches
```bash
# Clear Vercel cache
vercel cache clean

# Clear browser cache
# Chrome: Settings → Privacy → Clear browsing data → Cached images and files

# Clear DNS cache (Windows)
ipconfig /flushdns

# Clear DNS cache (Mac)
sudo dscacheutil -flushcache
```

---

## 🔧 MANUAL CACHE PURGE (Nuclear Option)

If the bug persists after deployment:

### 1. Vercel Dashboard Method
1. Go to Vercel Dashboard
2. Select project
3. Deployments tab
4. Find latest deployment
5. Click "..." menu
6. Select "Redeploy"
7. Check "Skip build cache"
8. Click "Redeploy"

### 2. Force New Deployment
```bash
# Bump version again
# Edit package.json: "version": "0.1.2"

# Empty commit to force redeploy
git commit --allow-empty -m "Force rebuild with clean cache"
git push origin main
```

### 3. Users Must Hard Refresh
Tell all users to:
- Close all game tabs
- Clear browser cache
- Open game in incognito mode
- Or hard refresh: `Ctrl + Shift + R`

---

## 📊 CACHE STRATEGY SUMMARY

| Resource | Cache Duration | Strategy |
|----------|---------------|----------|
| Game HTML | No cache | Always fresh |
| JavaScript bundles | 1 year | Immutable with unique build ID |
| Images (PNG, WebP) | 1 year | Immutable |
| Audio (MP3) | 1 year | Immutable |
| Service Worker | No cache | Must revalidate |

**Key Insight:** HTML is never cached, but JavaScript bundles are cached forever. Each deployment gets a unique build ID, so old JavaScript is never served.

---

## 🎮 EXPECTED BEHAVIOR AFTER FIX

### Purple Team (Team 1)
1. Attacker moves to row 1 (opponent's goal zone)
2. Choice UI: "STAY" or "SHOOT GOAL"
3. Click "SHOOT GOAL" → Duel starts
4. Both teams choose LEFT/MIDDLE/RIGHT
5. Duel resolves (goal or save)
6. **Attacker resets from row 1 → row 3** (back 2 blocks)

### Yellow Team (Team 2)
1. Attacker moves to row 5 (opponent's goal zone)
2. Choice UI: "STAY" or "SHOOT GOAL"
3. Click "SHOOT GOAL" → Duel starts
4. Both teams choose LEFT/MIDDLE/RIGHT
5. Duel resolves (goal or save)
6. **Attacker resets from row 5 → row 3** (back 2 blocks)

**CRITICAL:** Reset happens AFTER duel completes, not when clicking "SHOOT GOAL"

---

## 🐛 IF BUG PERSISTS

If yellow attacker still moves back before shooting after all cache clearing:

### It might be a real code bug, not cache:

1. **Check DRESET timing:**
   - Is DRESET called when clicking "SHOOT GOAL"?
   - Or is it called after duel completes?

2. **Add console logs:**
   ```typescript
   case 'ATTACKER_CHOICE': {
     console.log('[ATTACKER_CHOICE]', a.choice)
     // ... existing code
   }

   case 'DRESET': {
     console.log('[DRESET] Resetting attacker', { team: s.pieces.find(p => p.id === s.duel!.attackerId)!.team })
     // ... existing code
   }
   ```

3. **Test sequence in production:**
   - Open console (F12)
   - Perform attack with Yellow team
   - Check console logs for timing
   - Report exact sequence

4. **Possible real bug:**
   - DRESET is called too early (before duel starts)
   - Visual timing issue (attacker moves during animation)
   - State sync issue between clients

---

## 📝 DEPLOYMENT LOG

| Date | Version | Changes | Status |
|------|---------|---------|--------|
| 2025-01-16 | 0.1.0 | Initial deployment | ⚠️ Yellow attacker bug |
| 2025-01-16 | 0.1.1 | Cache busting + broom UI fix | 🔄 Testing |

---

## ✅ NEXT STEPS

1. ✅ Commit cache busting changes
2. ✅ Push to GitHub
3. 🔄 Clear Vercel cache
4. 🔄 Deploy to Vercel
5. 🔄 Test in incognito mode
6. 🔄 Test yellow team attacker
7. 🔄 Report results

---

**Last Updated:** January 16, 2025  
**Status:** 🔄 Cache busting implemented, awaiting deployment test
