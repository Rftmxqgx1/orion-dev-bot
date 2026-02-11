require('dotenv').config()
const express = require('express')
const { createJobBranch } = require('./github')
const { sendWhatsAppMessage } = require('./whatsapp')

const app = express()
app.use(express.json())

app.post('/webhook/whatsapp', async (req, res) => {
    const message = req.body.Body
    const from = req.body.From

    console.log("📩 Task received:", message)

    try {
        const branch = await createJobBranch(message)
        await sendWhatsAppMessage(from, `🛠️ Job started on branch: ${branch}`)
        res.sendStatus(200)
    } catch (err) {
        console.error(err)
        res.sendStatus(500)
    }
})

app.listen(4000, () => console.log("🚀 Orion AutoDev Webhook running"))
