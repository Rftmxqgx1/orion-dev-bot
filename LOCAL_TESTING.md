# Local Testing Guide

## Test the Server Locally (Before Deployment)

### Step 1: Install Dependencies
```powershell
cd C:\Users\Private\Documents\orion-dev-bot\server
npm install
```

### Step 2: Create .env File
Create `server/.env` with:
```
GITHUB_TOKEN=your_github_token_here
TWILIO_SID=your_twilio_sid
TWILIO_AUTH=your_twilio_auth
TWILIO_NUMBER=whatsapp:+14155238886
REPO_OWNER=Rftmxqgx1
REPO_NAME=orion-dev-bot
PORT=4000
```

### Step 3: Start Server
```powershell
cd C:\Users\Private\Documents\orion-dev-bot\server
npm start
```

You should see:
```
🚀 Orion AutoDev Webhook running
```

### Step 4: Test the Webhook (New PowerShell Window)

```powershell
# Test using Invoke-WebRequest
$body = @{
    Body = "Create health check endpoint"
    From = "whatsapp:+1234567890"
} | ConvertTo-Json

Invoke-WebRequest -Uri http://localhost:4000/webhook/whatsapp `
    -Method POST `
    -Body $body `
    -ContentType "application/json"
```

OR use curl if you have it:
```bash
curl -X POST http://localhost:4000/webhook/whatsapp \
  -H "Content-Type: application/json" \
  -d '{"Body": "Create health check endpoint", "From": "whatsapp:+1234567890"}'
```

### Expected Response:
- Status: 200 OK
- Server logs: "📩 Task received: Create health check endpoint"
- Server logs: "🛠️ Job started on branch: job/1234567890"

### Step 5: Check GitHub
Go to: https://github.com/Rftmxqgx1/orion-dev-bot/branches

You should see a new branch created!

---

## Troubleshooting Local Testing

### Error: "Cannot find module 'express'"
```powershell
cd server
npm install
```

### Error: "GITHUB_TOKEN is not defined"
Create `.env` file in `server/` directory with your credentials

### Error: "Octokit authentication failed"
- Check your GITHUB_TOKEN is valid
- Token needs `repo` and `workflow` scopes
- Generate new token: https://github.com/settings/tokens/new

### Port Already in Use
Change PORT in `.env` to something else (e.g., 4001)

---

## Testing Without Twilio

If you don't have Twilio set up yet, you can test the GitHub integration:

```javascript
// Create test-webhook.js in server/ directory
const { createJobBranch } = require('./src/github')

async function test() {
    const branch = await createJobBranch("Create health endpoint")
    console.log("✅ Branch created:", branch)
}

test()
```

Run:
```powershell
cd server
node test-webhook.js
```

---

## Quick Commands Reference

**Start server:**
```powershell
cd C:\Users\Private\Documents\orion-dev-bot\server
npm start
```

**Install dependencies:**
```powershell
cd C:\Users\Private\Documents\orion-dev-bot\server
npm install
```

**Run in development mode (auto-restart):**
```powershell
cd C:\Users\Private\Documents\orion-dev-bot\server
npm run dev
```
(Note: You need to install nodemon first: `npm install --save-dev nodemon`)

**Check logs:**
Server prints to console in real-time

---

## Next: Deploy to Production

Once local testing works, deploy using:
- Railway.app (recommended)
- Render.com
- Fly.io

See NEXT_STEPS.md for deployment instructions.
