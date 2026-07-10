const express = require('express');
const { default: makeWASocket, useMultiFileAuthState, Browsers, delay } = require('@whiskeysockets/baileys');
const pino = require('pino');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static('public'));
app.use(express.json());

app.post('/generate', async (req, res) => {
    try {
        const { number } = req.body;
        const { state, saveCreds } = await useMultiFileAuthState('./auth_info');
        
        const sock = makeWASocket({
            auth: state,
            logger: pino({ level: 'silent' }),
            browser: Browsers.macOS('Chrome')
        });

        if (!sock.authState.creds.registered) {
            await delay(1500);
            const code = await sock.requestPairingCode(number);
            return res.json({ code });
        }
    } catch (err) {
        console.error("Error:", err);
        res.status(500).json({ error: "Failed to generate code" });
    }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
