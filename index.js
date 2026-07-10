const express = require('express');
const { default: makeWASocket, useMultiFileAuthState, Browsers } = require('@whiskeysockets/baileys');
const pino = require('pino');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static('public'));
app.use(express.json());

app.post('/generate', async (req, res) => {
    const { number, imageUrl } = req.body;
    const { state, saveCreds } = await useMultiFileAuthState('./auth_info');
    
    const sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' }),
        browser: Browsers.macOS('Chrome')
    });

    if (!sock.authState.creds.registered) {
        const code = await sock.requestPairingCode(number);
        res.json({ code });
    }

    sock.ev.on('connection.update', async (update) => {
        const { connection } = update;
        if (connection === 'open') {
            // මෙතැනදී තමයි DP එක දාන්නේ
            await sock.updateProfilePicture(sock.user.id, { url: imageUrl });
            console.log("DP Updated Successfully!");
        }
    });

    sock.ev.on('creds.update', saveCreds);
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
