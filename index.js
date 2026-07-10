const express = require('express');
const { default: makeWASocket, useMultiFileAuthState, Browsers, delay } = require('@whiskeysockets/baileys');
const pino = require('pino');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static('public'));
app.use(express.json());

// Main function to start socket
async function startBot(number, imageUrl, res) {
    const { state, saveCreds } = await useMultiFileAuthState('./auth_info');
    
    const sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' }),
        browser: Browsers.macOS('Chrome')
    });

    if (!sock.authState.creds.registered) {
        const code = await sock.requestPairingCode(number.replace(/[^0-9]/g, ''));
        res.json({ code });
    }

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection } = update;
        if (connection === 'open') {
            console.log("Connected to WhatsApp!");
            try {
                // DP එක Update කිරීම
                await sock.updateProfilePicture(sock.user.id, { url: imageUrl });
                console.log("DP Updated Successfully.");
            } catch (err) {
                console.error("DP Update Failed:", err);
            }
        }
    });
}

app.post('/generate', async (req, res) => {
    const { number, imageUrl } = req.body;
    if (!number || !imageUrl) return res.status(400).json({ error: "Details missing" });
    
    await startBot(number, imageUrl, res);
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
