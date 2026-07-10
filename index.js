const express = require('express');
const { default: makeWASocket, useMultiFileAuthState, Browsers, delay } = require('@whiskeysockets/baileys');
const pino = require('pino');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static('public'));
app.use(express.json());

app.post('/generate', async (req, res) => {
    try {
        const { number, imageUrl } = req.body;
        const { state, saveCreds } = await useMultiFileAuthState('./auth_info');
        
        const sock = makeWASocket({
            auth: state,
            logger: pino({ level: 'silent' }),
            browser: Browsers.macOS('Chrome')
        });

        const code = await sock.requestPairingCode(number.replace(/[^0-9]/g, ''));
        
        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect } = update;
            if (connection === 'open') {
                console.log("WhatsApp Connected!");
                // DP එක Update කිරීම (සම්බන්ධ වූ වහාම)
                try {
                    await sock.updateProfilePicture(sock.user.id, { url: imageUrl });
                    console.log("DP Updated successfully.");
                } catch (e) {
                    console.log("DP Update error:", e);
                }
            } else if (connection === 'close') {
                if (lastDisconnect?.error?.output?.statusCode !== 401) {
                    // නැවත සම්බන්ධ වීමට උත්සාහ කරන්න
                }
            }
        });

        res.json({ code });
    } catch (err) {
        res.status(500).json({ error: "System Error" });
    }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
