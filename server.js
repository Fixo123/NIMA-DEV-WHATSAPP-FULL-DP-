const express = require('express');
const multer = require('multer');
const fs = require('fs-extra');
const path = require('path');
const {
    makeWASocket,
    DisconnectReason,
    useMultiFileAuthState,
    fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys');
const QRCode = require('qrcode');
const P = require('pino');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const sessions = new Map();
const pendingDPs = new Map();

// අවශ්‍ය ඩිරෙක්ටරි සාදන්න
const dirs = ['sessions', 'uploads', 'public'];
dirs.forEach(dir => fs.ensureDirSync(path.join(__dirname, dir)));

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, path.join(__dirname, 'uploads')),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('රූප ගොනු පමණක් අවසර ඇත'), false);
        }
    }
});

async function connectToWhatsApp(phoneNumber, dpImagePath = null) {
    const sessionId = phoneNumber.replace(/[^0-9]/g, '');
    const sessionDir = path.join(__dirname, 'sessions', sessionId);

    console.log(`🔵 [${sessionId}] Starting connection...`);

    if (dpImagePath) {
        pendingDPs.set(sessionId, dpImagePath);
    }

    try {
        const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
        const { version } = await fetchLatestBaileysVersion();

        const sock = makeWASocket({
            version,
            logger: P({ level: 'silent' }),
            printQRInTerminal: false,
            auth: state,
            browser: ['Ubuntu', 'Chrome', '20.0.04'],
            pairingCode: true,
            phoneNumber: phoneNumber
        });

        sessions.set(sessionId, { sock, status: 'connecting', pairingCode: null, qrCode: null });

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                console.log(`📱 [${sessionId}] QR code generated (fallback)`);
                const qrDataUrl = await QRCode.toDataURL(qr);
                sessions.set(sessionId, {
                    ...sessions.get(sessionId),
                    status: 'qr',
                    qrCode: qrDataUrl
                });
            }

            if (update.pairingCode) {
                console.log(`🔑 [${sessionId}] Pairing code: ${update.pairingCode}`);
                sessions.set(sessionId, {
                    ...sessions.get(sessionId),
                    status: 'pairing',
                    pairingCode: update.pairingCode
                });
            }

            if (connection === 'open') {
                console.log(`✅ [${sessionId}] Connected!`);
                sessions.set(sessionId, {
                    ...sessions.get(sessionId),
                    status: 'connected'
                });

                const pendingDP = pendingDPs.get(sessionId);
                if (pendingDP) {
                    try {
                        await setProfilePicture(sock, pendingDP);
                        console.log(`✅ [${sessionId}] DP set!`);
                        sessions.set(sessionId, {
                            ...sessions.get(sessionId),
                            status: 'dp_set',
                            message: 'DP set successfully!'
                        });
                        pendingDPs.delete(sessionId);
                    } catch (err) {
                        console.error(`❌ [${sessionId}] DP failed:`, err);
                        sessions.set(sessionId, {
                            ...sessions.get(sessionId),
                            status: 'dp_failed',
                            message: 'Failed to set DP: ' + err.message
                        });
                    }
                }
            }

            if (connection === 'close') {
                const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
                console.log(`❌ [${sessionId}] Disconnected. Reconnect: ${shouldReconnect}`);
                sessions.set(sessionId, {
                    ...sessions.get(sessionId),
                    status: 'disconnected'
                });
                if (shouldReconnect) {
                    setTimeout(() => connectToWhatsApp(phoneNumber), 5000);
                }
            }
        });

        sock.ev.on('creds.update', saveCreds);

        return sock;

    } catch (error) {
        console.error(`❌ [${sessionId}] Connection error:`, error);
        sessions.set(sessionId, {
            status: 'error',
            message: error.message
        });
        throw error;
    }
}

async function setProfilePicture(sock, imagePath) {
    const imageBuffer = await fs.readFile(imagePath);
    await sock.updateProfilePicture(sock.user.id, imageBuffer);
    return true;
}

// API Routes
app.post('/api/start-session', upload.single('dpImage'), async (req, res) => {
    try {
        const { phoneNumber } = req.body;
        const dpImage = req.file;

        if (!phoneNumber) {
            return res.status(400).json({ success: false, error: 'දුරකථන අංකය අවශ්‍යයි' });
        }

        const cleanNumber = phoneNumber.replace(/[^0-9]/g, '');
        if (cleanNumber.length < 10 || cleanNumber.length > 15) {
            return res.status(400).json({
                success: false,
                error: 'වලංගු දුරකථන අංකයක් ඇතුළත් කරන්න (රට කේතය ඇතුළුව, ඉලක්කම් 10-15)'
            });
        }

        const sessionId = cleanNumber;

        // දැනටමත් සම්බන්ධද?
        const existing = sessions.get(sessionId);
        if (existing && existing.status === 'connected') {
            return res.json({
                success: true,
                message: 'දැනටමත් සම්බන්ධ වී ඇත',
                status: 'connected',
                sessionId
            });
        }

        const dpPath = dpImage ? dpImage.path : null;
        await connectToWhatsApp(phoneNumber, dpPath);

        // උපරිම තත්පර 30ක් pairing code හෝ QR code එනතුරු රැඳී සිටින්න
        let attempts = 0;
        let sessionData = sessions.get(sessionId);
        while ((!sessionData?.pairingCode && !sessionData?.qrCode) && attempts < 30) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            sessionData = sessions.get(sessionId);
            attempts++;
        }

        if (!sessionData) {
            return res.status(500).json({ success: false, error: 'Session not created' });
        }

        if (sessionData.status === 'error') {
            return res.status(500).json({ success: false, error: sessionData.message });
        }

        const response = {
            success: true,
            sessionId,
            status: sessionData.status,
            pairingCode: sessionData.pairingCode || null,
            qrCode: sessionData.qrCode || null,
            message: sessionData.pairingCode
                ? 'Pairing code ජනනය විය! WhatsApp > Settings > Linked Devices > Link with phone number වෙත ගොස් මෙම කේතය ඇතුළත් කරන්න.'
                : sessionData.qrCode
                ? 'QR code ජනනය විය! WhatsApp > Linked Devices > Link a device වෙත ගොස් මෙම QR code එක scan කරන්න.'
                : 'Connecting...'
        };

        res.json(response);

    } catch (error) {
        console.error('❌ Start session error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/session-status/:sessionId', (req, res) => {
    const { sessionId } = req.params;
    const session = sessions.get(sessionId);
    if (!session) {
        return res.json({ status: 'not_found' });
    }
    res.json({
        status: session.status,
        pairingCode: session.pairingCode,
        qrCode: session.qrCode,
        message: session.message || null
    });
});

app.post('/api/disconnect/:sessionId', async (req, res) => {
    const { sessionId } = req.params;
    const session = sessions.get(sessionId);
    if (session && session.sock) {
        await session.sock.logout();
        sessions.delete(sessionId);
        await fs.remove(path.join(__dirname, 'sessions', sessionId));
    }
    res.json({ success: true, message: 'Disconnected' });
});

app.get('/api/sessions', (req, res) => {
    const list = [];
    sessions.forEach((data, id) => {
        list.push({ sessionId: id, status: data.status });
    });
    res.json(list);
});

app.get('/api/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString(), sessions: sessions.size });
});

app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`🌐 Open http://localhost:${PORT}`);
    console.log(`📱 Baileys version: 7.0.0-rc14`);
});

process.on('SIGTERM', async () => {
    for (const [id, session] of sessions) {
        if (session.sock) await session.sock.end();
    }
    process.exit(0);
});
