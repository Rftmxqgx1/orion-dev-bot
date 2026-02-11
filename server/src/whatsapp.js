const twilio = require('twilio')

const client = twilio(process.env.TWILIO_SID, process.env.TWILIO_AUTH)

async function sendWhatsAppMessage(to, msg) {
    await client.messages.create({
        from: 'whatsapp:' + process.env.TWILIO_NUMBER,
        to,
        body: msg
    })
}

module.exports = { sendWhatsAppMessage }
