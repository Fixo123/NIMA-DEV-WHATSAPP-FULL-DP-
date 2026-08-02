const express = require('express');
const multer = require('multer');
const fs = require('fs-extra');
const path = require('path');

// Baileys - Custom fork support
let makeWASocket, DisconnectReason, useMultiFileAuthState, fetchLatestBaileysVersion;

try {
  const baileys = require('baileys');
  makeWASocket = baileys.default?.makeWASocket || baileys.makeWASocket;
  DisconnectReason = baileys.DisconnectReason;
  useMultiFileAuthState = baileys.useMultiFileAuthState;
  fetchLatestBaileysVersion = baileys.fetchLatestBaileysVersion;
  console.log('✅ Baileys loaded from custom fork');
} catch (err) {
  console.log('⚠️ Custom fork not found, trying fallback...');
  try {
    const baileys = require('@whiskeysockets/baileys');
    makeWASocket = baileys.makeWASocket;
    DisconnectReason = baileys.DisconnectReason;
    useMultiFileAuthState = baileys.useMultiFileAuthState;
    fetchLatestBaileysVersion = baileys.fetchLatestBaileysVersion;
    console.log('✅ Baileys loaded from @whiskeysockets/baileys (fallback)');
  } catch (fallbackError) {
    console.error('❌ Cannot load Baileys:', fallbackError.message);
    process.exit(1);
  }
}

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
    destination: (req, file, cb) => {
        cb(null, path.join(__dirname, 'uploads'));
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + '-' + file.originalname);
    }
});
const upload = multer({
    storage,
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

    if (dpImagePath) {
        pendingDPs.set(sessionId, dpImagePath);
    }

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

    sessions.set(sessionId, { sock, status: 'connecting', pairingCode: null });

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            const qrDataUrl = await QRCode.toDataURL(qr);
            sessions.set(sessionId, {
                ...sessions.get(sessionId),
                status: 'qr',
                qrCode: qrDataUrl
            });
        }

        if (update.pairingCode) {
            console.log(`Pairing code for ${phoneNumber}:`, update.pairingCode);
            sessions.set(sessionId, {
                ...sessions.get(sessionId),
                status: 'pairing',
                pairingCode: update.pairingCode
            });
        }

        if (connection === 'open') {
            console.log(`Connected: ${phoneNumber}`);
            sessions.set(sessionId, {
                ...sessions.get(sessionId),
                status: 'connected'
            });

            const pendingDP = pendingDPs.get(sessionId);
            if (pendingDP) {
                try {
                    await setProfilePicture(sock, pendingDP);
                    console.log('DP set successfully!');
                    sessions.set(sessionId, {
                        ...sessions.get(sessionId),
                        status: 'dp_set',
                        message: 'DP set successfully!'
                    });
                    pendingDPs.delete(sessionId);
                } catch (err) {
                    console.error('Failed to set DP:', err);
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
            console.log('Connection closed. Reconnect:', shouldReconnect);

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
            return res.status(400).json({ error: 'දුරකථන අංකය අවශ්‍යයි' });
        }

        const cleanNumber = phoneNumber.replace(/[^0-9]/g, '');
        if (cleanNumber.length < 10) {
            return res.status(400).json({ error: 'වලංගු දුරකථන අංකයක් ඇතුළත් කරන්න' });
        }

        const sessionId = cleanNumber;

        if (sessions.has(sessionId) && sessions.get(sessionId).status === 'connected') {
            return res.json({
                success: true,
                message: 'දැනටමත් සම්බන්ධ වී ඇත',
                status: 'connected',
                sessionId
            });
        }

        const dpPath = dpImage ? dpImage.path : null;
        await connectToWhatsApp(phoneNumber, dpPath);

        // Pairing code එනතුරු රැඳී සිටින්න
        let attempts = 0;
        let sessionData = sessions.get(sessionId);
        while (!sessionData?.pairingCode && attempts < 30) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            sessionData = sessions.get(sessionId);
            attempts++;
        }

        res.json({
            success: true,
            sessionId,
            status: sessionData?.status || 'connecting',
            pairingCode: sessionData?.pairingCode || null,
            message: sessionData?.pairingCode
                ? 'Pairing code ජනනය විය! WhatsApp > Settings > Linked Devices > Link with phone number වෙත ගොස් මෙම කේතය ඇතුළත් කරන්න.'
                : 'සම්බන්ධ වෙමින්...'
        });

    } catch (error) {
        console.error('Start session error:', error);
        res.status(500).json({ error: error.message });
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
        message: session.message || null,
        qrCode: session.qrCode || null
    });
});

app.post('/api/disconnect/:sessionId', async (req, res) => {
    const { sessionId } = req.params;
    const session = sessions.get(sessionId);

    if (session && session.sock) {
        await session.sock.logout();
        sessions.delete(sessionId);
        const sessionDir = path.join(__dirname, 'sessions', sessionId);
        await fs.remove(sessionDir);
    }

    res.json({ success: true, message: 'Disconnected' });
});

app.get('/api/sessions', (req, res) => {
    const sessionList = [];
    sessions.forEach((data, id) => {
        sessionList.push({
            sessionId: id,
            status: data.status,
            pairingCode: data.pairingCode
        });
    });
    res.json(sessionList);
});

app.get('/api/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`🌐 Open http://localhost:${PORT} to access the web interface`);
});

process.on('SIGTERM', async () => {
    console.log('SIGTERM received, closing connections...');
    for (const [id, session] of sessions) {
        if (session.sock) {
            await session.sock.end();
        }
    }
    process.exit(0);
});
