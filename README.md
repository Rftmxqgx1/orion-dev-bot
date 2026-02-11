# 🤖 Orion AutoDev

Autonomous coding agent that receives tasks via WhatsApp, creates branches, runs AI agents, and opens PRs automatically.

## 🏗️ Architecture

- **Server**: Express webhook receiver for WhatsApp messages
- **Agent**: Dockerized autonomous coding agent (Claude/OpenAI)
- **GitHub Actions**: Orchestrates the agent execution
- **WhatsApp**: Task input and status notifications

## 📁 Structure

```
orion-autodev/
├── server/           # Webhook event handler
├── agent/            # Dockerized coding agent
├── .github/          # GitHub Actions workflow
├── prompts/          # Task instruction templates
└── README.md
```

## 🚀 Quick Start

### 1. Clone and Install

```bash
git clone https://github.com/Rftmxqgx1/orion-autodev.git
cd orion-autodev/server
npm install
```

### 2. Set Up Environment Variables

Create `.env` file in `server/` directory:

```env
GITHUB_TOKEN=your_github_token
TWILIO_SID=your_twilio_sid
TWILIO_AUTH=your_twilio_auth_token
TWILIO_NUMBER=your_twilio_whatsapp_number
REPO_OWNER=your_github_username
REPO_NAME=orion-autodev
```

### 3. Deploy Server

Deploy to Railway, Render, Fly.io, or any hosting service:

```bash
cd server
npm start
```

### 4. Configure GitHub Secrets

Go to your repo → Settings → Secrets and add:

- `GITHUB_TOKEN`
- `TWILIO_SID`
- `TWILIO_AUTH`
- `TWILIO_NUMBER`
- `REPO_OWNER`
- `REPO_NAME`

### 5. Set Up Twilio WhatsApp

1. Sign up at [Twilio](https://www.twilio.com/)
2. Go to WhatsApp Sandbox
3. Set webhook URL to: `https://your-server.com/webhook/whatsapp`

## 📱 Usage

Send a WhatsApp message to your Twilio number:

```
Create health endpoint in portfolio engine
```

The system will:
1. ✅ Create a new branch
2. 🤖 Run the coding agent
3. 📝 Commit changes
4. 🔀 Open a pull request
5. 📲 Send you a WhatsApp confirmation

## 🔧 Customization

### Replace the Agent

Edit `agent/run-agent.sh` to use:
- Claude Code CLI
- OpenAI Agents
- Custom coding tools

### Modify Prompts

Edit templates in `prompts/` directory to customize agent behavior.

## 🛠️ Development

```bash
# Run server in dev mode
cd server
npm run dev
```

## 📝 License

MIT

## 🤝 Contributing

Pull requests welcome!

---

Built with 🧠 by the Orion team
