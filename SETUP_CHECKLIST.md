# 🚀 Orion AutoDev - Complete Setup Checklist

## ✅ Step 1: Local Repository (COMPLETED)
- [x] Repository structure created
- [x] All files created
- [x] Git initialized
- [x] Initial commit made
- [x] Location: C:\Users\Private\Documents\orion-autodev

## 📤 Step 2: Push to GitHub (TODO)

1. **Create GitHub Repository**
   - Go to: https://github.com/new
   - Name: `orion-autodev`
   - Description: "WhatsApp-driven autonomous coding agent"
   - DO NOT initialize with README
   - Click "Create repository"

2. **Push Local Code**
   - Option A: Run `push-to-github.ps1` (edit username first)
   - Option B: Follow commands in `GITHUB_SETUP.txt`

## 🔐 Step 3: Configure GitHub Secrets

Go to: Settings → Secrets and variables → Actions → New repository secret

Add these secrets:
- [ ] `GITHUB_TOKEN` - Personal Access Token with repo permissions
- [ ] `TWILIO_SID` - From Twilio Console
- [ ] `TWILIO_AUTH` - From Twilio Console  
- [ ] `TWILIO_NUMBER` - Your Twilio WhatsApp number
- [ ] `REPO_OWNER` - Your GitHub username
- [ ] `REPO_NAME` - orion-autodev

## 📱 Step 4: Set Up Twilio WhatsApp

1. **Sign Up for Twilio**
   - Go to: https://www.twilio.com/
   - Create free account

2. **WhatsApp Sandbox Setup**
   - Navigate to: Messaging → Try it out → Send a WhatsApp message
   - Follow the instructions to connect your phone
   - Note down the Sandbox number

3. **Configure Webhook**
   - After deploying server, set webhook URL in Twilio Console
   - URL: `https://your-server.com/webhook/whatsapp`
   - Method: POST

## 🚀 Step 5: Deploy Server

Choose one platform:

### Railway.app (Recommended)
- [ ] Connect GitHub repo
- [ ] Add environment variables
- [ ] Deploy

### Render.com
- [ ] Connect GitHub repo
- [ ] Select "Web Service"
- [ ] Build: `cd server && npm install`
- [ ] Start: `cd server && npm start`
- [ ] Add environment variables

### Fly.io
```bash
cd server
fly launch
fly secrets set GITHUB_TOKEN=xxx TWILIO_SID=xxx ...
fly deploy
```

## 🔧 Step 6: Create .env File (For Local Testing)

In `server/` directory, create `.env`:
```
GITHUB_TOKEN=your_token
TWILIO_SID=your_sid
TWILIO_AUTH=your_auth
TWILIO_NUMBER=whatsapp:+14155238886
REPO_OWNER=your_username
REPO_NAME=orion-autodev
PORT=4000
```

## 🧪 Step 7: Test Locally

```bash
cd server
npm install
npm start
```

Test webhook with curl or Postman:
```bash
curl -X POST http://localhost:4000/webhook/whatsapp \
  -H "Content-Type: application/json" \
  -d '{"Body": "Create health endpoint", "From": "whatsapp:+1234567890"}'
```

## ✨ Step 8: First WhatsApp Task

Send a message to your Twilio WhatsApp number:
```
Create health endpoint in portfolio engine
```

Expected flow:
1. ✅ Branch created: `job/1234567890`
2. 🤖 GitHub Action runs
3. 📝 Agent makes changes
4. 🔀 Pull request opened
5. 📲 WhatsApp confirmation sent

## 🎯 Next Steps

- [ ] Customize agent in `agent/run-agent.sh`
- [ ] Add Claude Code or OpenAI integration
- [ ] Modify prompts in `prompts/dev-task.txt`
- [ ] Add more sophisticated task parsing
- [ ] Add error handling and retries
- [ ] Set up monitoring/logging

---

🎉 Once complete, you'll have a fully autonomous coding agent!
