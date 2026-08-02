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
dirs.forEach(dir => {
    try {
        fs.ensureDirSync(path.join(__dirname, dir));
        console.log(`✅ Directory created: ${dir}`);
    } catch (err) {
        console.error(`❌ Failed to create ${dir}:`, err.message);
    }
});

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
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
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
    console.log(`📁 Session directory: ${sessionDir}`);

    if (dpImagePath) {
        console.log(`🖼️ DP image path: ${dpImagePath}`);
        pendingDPs.set(sessionId, dpImagePath);
    }

    try {
        const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
        console.log(`✅ [${sessionId}] Auth state loaded`);

        const { version } = await fetchLatestBaileysVersion();
        console.log(`📦 [${sessionId}] Baileys version: ${version.join('.')}`);

        const sock = makeWASocket({
            version,
            logger: P({ level: 'silent' }),
            printQRInTerminal: false,
            auth: state,
            browser: ['Ubuntu', 'Chrome', '20.0.04'],
            pairingCode: true,
            phoneNumber: phoneNumber
        });

        console.log(`🔌 [${sessionId}] Socket created`);

        sessions.set(sessionId, { sock, status: 'connecting', pairingCode: null });

        // Connection update handler
        sock.ev.on('connection.update', async (update) => {
            console.log(`📡 [${sessionId}] Update:`, Object.keys(update));

            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                console.log(`📱 [${sessionId}] QR code generated`);
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
                console.log(`✅ [${sessionId}] Connected successfully!`);
                sessions.set(sessionId, {
                    ...sessions.get(sessionId),
                    status: 'connected'
                });

                const pendingDP = pendingDPs.get(sessionId);
                if (pendingDP) {
                    console.log(`🖼️ [${sessionId}] Setting DP...`);
                    try {
                        await setProfilePicture(sock, pendingDP);
                        console.log(`✅ [${sessionId}] DP set successfully!`);
                        sessions.set(sessionId, {
                            ...sessions.get(sessionId),
                            status: 'dp_set',
                            message: 'DP set successfully!'
                        });
                        pendingDPs.delete(sessionId);
                    } catch (err) {
                        console.error(`❌ [${sessionId}] DP set failed:`, err);
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
                console.log(`❌ [${sessionId}] Connection closed. Reconnect: ${shouldReconnect}`);

                sessions.set(sessionId, {
                    ...sessions.get(sessionId),
                    status: 'disconnected'
                });

                if (shouldReconnect) {
                    console.log(`🔄 [${sessionId}] Reconnecting in 5 seconds...`);
                    setTimeout(() => connectToWhatsApp(phoneNumber), 5000);
                }
            }
        });

        sock.ev.on('creds.update', (creds) => {
            console.log(`💾 [${sessionId}] Credentials updated`);
            saveCreds();
        });

        return sock;

    } catch (error) {
        console.error(`❌ [${sessionId}] Connection error:`, error);
        sessions.set(sessionId, {
            ...sessions.get(sessionId),
            status: 'error',
            message: error.message
        });
        throw error;
    }
}

async function setProfilePicture(sock, imagePath) {
    try {
        const imageBuffer = await fs.readFile(imagePath);
        console.log(`📄 Image size: ${imageBuffer.length} bytes`);
        await sock.updateProfilePicture(sock.user.id, imageBuffer);
        return true;
    } catch (error) {
        console.error('Error setting DP:', error);
        throw error;
    }
}

// API Routes
app.post('/api/start-session', upload.single('dpImage'), async (req, res) => {
    console.log('📨 POST /api/start-session called');
    
    try {
        const { phoneNumber } = req.body;
        const dpImage = req.file;

        console.log(`📱 Phone: ${phoneNumber}`);
        console.log(`🖼️ DP File: ${dpImage ? dpImage.originalname : 'None'}`);

        if (!phoneNumber) {
            console.log('❌ No phone number');
            return res.status(400).json({ 
                success: false, 
                error: 'දුරකථන අංකය අවශ්‍යයි' 
            });
        }

        const cleanNumber = phoneNumber.replace(/[^0-9]/g, '');
        console.log(`🧹 Clean number: ${cleanNumber}`);

        if (cleanNumber.length < 10) {
            console.log('❌ Invalid phone number length');
            return res.status(400).json({ 
                success: false, 
                error: 'වලංගු දුරකථන අංකයක් ඇතුළත් කරන්න (අවම 10 ඉලක්කම්)' 
            });
        }

        const sessionId = cleanNumber;

        // Check if already connected
        if (sessions.has(sessionId) && sessions.get(sessionId).status === 'connected') {
            console.log(`✅ [${sessionId}] Already connected`);
            return res.json({
                success: true,
                message: 'දැනටමත් සම්බන්ධ වී ඇත',
                status: 'connected',
                sessionId
            });
        }

        const dpPath = dpImage ? dpImage.path : null;
        console.log(`🔄 [${sessionId}] Starting connection...`);

        // Start connection
        await connectToWhatsApp(phoneNumber, dpPath);

        // Wait for pairing code with timeout
        console.log(`⏳ [${sessionId}] Waiting for pairing code...`);
        let attempts = 0;
        let sessionData = sessions.get(sessionId);
        
        while ((!sessionData?.pairingCode || sessionData?.status === 'connecting') && attempts < 30) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            sessionData = sessions.get(sessionId);
            attempts++;
            console.log(`⏳ [${sessionId}] Attempt ${attempts}/30, status: ${sessionData?.status}`);
        }

        console.log(`📤 [${sessionId}] Response:`, {
            status: sessionData?.status,
            hasPairingCode: !!sessionData?.pairingCode
        });

        if (sessionData?.status === 'error') {
            return res.status(500).json({
                success: false,
                error: sessionData.message || 'Connection failed'
            });
        }

        res.json({
            success: true,
            sessionId,
            status: sessionData?.status || 'connecting',
            pairingCode: sessionData?.pairingCode || null,
            message: sessionData?.pairingCode
                ? 'Pairing code ජනනය විය! WhatsApp > Settings > Linked Devices > Link with phone number වෙත ගොස් මෙම කේතය ඇතුළත් කරන්න.'
                : 'Pairing code ජනනය වෙමින්... කරුණාකර රැඳී සිටින්න.'
        });

    } catch (error) {
        console.error('❌ POST /api/start-session error:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message || 'Internal server error',
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
});

app.get('/api/session-status/:sessionId', (req, res) => {
    const { sessionId } = req.params;
    const session = sessions.get(sessionId);

    console.log(`📊 [${sessionId}] Status check`);

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

    console.log(`🔌 [${sessionId}] Disconnecting...`);

    if (session && session.sock) {
        try {
            await session.sock.logout();
            sessions.delete(sessionId);
            const sessionDir = path.join(__dirname, 'sessions', sessionId);
            await fs.remove(sessionDir);
            console.log(`✅ [${sessionId}] Disconnected`);
        } catch (error) {
            console.error(`❌ [${sessionId}] Disconnect error:`, error);
        }
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
    res.json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        sessions: sessions.size
    });
});

app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`🌐 Open http://localhost:${PORT} to access the web interface`);
    console.log(`📱 Baileys version: npm:asepxyznew`);
    console.log(`🟢 Environment: ${process.env.NODE_ENV || 'development'}`);
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
