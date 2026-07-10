const fs = require('fs');
const path = require('path');

const files = {
    'package.json': `{
  "name": "whatsapp-dp-bot",
  "version": "1.0.0",
  "description": "WhatsApp DP Auto-Set with Pairing Code",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "dev": "nodemon server.js"
  },
  "engines": {
    "node": ">=18.0.0"
  },
  "dependencies": {
    "@whiskeysockets/baileys": "^7.0.0-rc13",
    "express": "^5.2.1",
    "multer": "^1.4.5-lts.1",
    "qrcode": "^1.5.4",
    "pino": "^10.3.1",
    "fs-extra": "^11.3.6",
    "axios": "^1.18.1",
    "dotenv": "^17.4.2",
    "cors": "^2.8.6",
    "jimp": "^1.6.1"
  },
  "devDependencies": {
    "nodemon": "^3.0.1"
  }
}`,

    '.env': `PORT=3000
NODE_ENV=production`,

    'Procfile': `web: node server.js`,

    '.gitignore': `node_modules/
sessions/
uploads/
.env
*.log`,

    'server.js': `const express = require('express');
const multer = require('multer');
const fs = require('fs-extra');
const path = require('path');
const { makeWASocket, DisconnectReason, useMultiFileAuthState, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const QRCode = require('qrcode');
const P = require('pino');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const sessions = new Map();
const pendingDPs = new Map();

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = path.join(__dirname, 'uploads');
        fs.ensureDirSync(uploadDir);
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + '-' + file.originalname);
    }
});
const upload = multer({ storage });

fs.ensureDirSync(path.join(__dirname, 'sessions'));
fs.ensureDirSync(path.join(__dirname, 'uploads'));

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
            console.log(\`Pairing code for \${phoneNumber}: \`, update.pairingCode);
            sessions.set(sessionId, { 
                ...sessions.get(sessionId), 
                status: 'pairing',
                pairingCode: update.pairingCode 
            });
        }

        if (connection === 'open') {
            console.log(\`Connected: \${phoneNumber}\`);
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

app.post('/api/start-session', upload.single('dpImage'), async (req, res) => {
    try {
        const { phoneNumber } = req.body;
        const dpImage = req.file;

        if (!phoneNumber) {
            return res.status(400).json({ error: 'Phone number required' });
        }

        const cleanNumber = phoneNumber.replace(/[^0-9]/g, '');
        if (cleanNumber.length < 10) {
            return res.status(400).json({ error: 'Invalid phone number' });
        }

        const sessionId = cleanNumber;
        
        if (sessions.has(sessionId) && sessions.get(sessionId).status === 'connected') {
            return res.json({ 
                success: true, 
                message: 'Already connected',
                status: 'connected',
                sessionId 
            });
        }

        const dpPath = dpImage ? dpImage.path : null;
        await connectToWhatsApp(phoneNumber, dpPath);

        await new Promise(resolve => setTimeout(resolve, 3000));

        const sessionData = sessions.get(sessionId) || {};
        
        res.json({
            success: true,
            sessionId,
            status: sessionData.status,
            pairingCode: sessionData.pairingCode || null,
            message: sessionData.pairingCode 
                ? 'Pairing code generated! Open WhatsApp > Settings > Linked Devices > Link with phone number' 
                : 'Connecting...'
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
    console.log(\`🚀 Server running on port \${PORT}\`);
    console.log(\`🌐 Open http://localhost:\${PORT} to access the web interface\`);
});

process.on('SIGTERM', async () => {
    console.log('SIGTERM received, closing connections...');
    for (const [id, session] of sessions) {
        if (session.sock) {
            await session.sock.end();
        }
    }
    process.exit(0);
});`,

    'public/index.html': `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>WhatsApp DP Auto-Set</title>
    <link rel="stylesheet" href="style.css">
</head>
<body>
    <div class="container">
        <header>
            <h1>📱 WhatsApp DP Auto-Set</h1>
            <p>Link your device and automatically set your profile picture</p>
        </header>

        <main>
            <div class="card" id="step1">
                <h2>Step 1: Enter Your Details</h2>
                <div class="form-group">
                    <label for="phoneNumber">WhatsApp Phone Number (with country code)</label>
                    <input type="text" id="phoneNumber" placeholder="e.g., 94712345678" maxlength="15">
                    <small>Example: 94712345678 (Sri Lanka)</small>
                </div>
                
                <div class="form-group">
                    <label for="dpImage">Select Profile Picture</label>
                    <div class="upload-area" id="uploadArea">
                        <input type="file" id="dpImage" accept="image/*" hidden>
                        <div class="upload-placeholder">
                            <span class="icon">📷</span>
                            <p>Click to upload or drag & drop</p>
                            <small>Supported: JPG, PNG, WEBP</small>
                        </div>
                        <img id="imagePreview" class="preview-image" hidden>
                    </div>
                </div>

                <button class="btn btn-primary" onclick="startSession()" id="startBtn">
                    Generate Pairing Code
                </button>
            </div>

            <div class="card hidden" id="step2">
                <h2>Step 2: Link Your Device</h2>
                <div class="pairing-code-container">
                    <p class="instruction">Your pairing code:</p>
                    <div class="code-display" id="pairingCode">----</div>
                    <button class="btn btn-copy" onclick="copyCode()">📋 Copy Code</button>
                </div>

                <div class="steps-instruction">
                    <h3>How to link:</h3>
                    <ol>
                        <li>Open <strong>WhatsApp</strong> on your phone</li>
                        <li>Go to <strong>Settings → Linked Devices</strong></li>
                        <li>Tap <strong>"Link with phone number instead"</strong></li>
                        <li>Enter the pairing code above</li>
                        <li>Your DP will be set automatically!</li>
                    </ol>
                </div>

                <div class="status-indicator" id="statusIndicator">
                    <span class="spinner"></span>
                    <span id="statusText">Waiting for connection...</span>
                </div>

                <div class="progress-bar" id="progressBar">
                    <div class="progress-fill"></div>
                </div>
            </div>

            <div class="card hidden" id="step3">
                <h2>✅ Success!</h2>
                <div class="success-message">
                    <div class="success-icon">🎉</div>
                    <p>Your WhatsApp profile picture has been set successfully!</p>
                    <p class="sub-text">Your device is now linked.</p>
                </div>
                <button class="btn btn-secondary" onclick="resetForm()">Start New Session</button>
            </div>

            <div class="card hidden error-card" id="errorCard">
                <h2>❌ Error</h2>
                <p id="errorMessage"></p>
                <button class="btn btn-secondary" onclick="resetForm()">Try Again</button>
            </div>
        </main>

        <footer>
            <p>Powered by Baileys | Multi-Device Support</p>
        </footer>
    </div>

    <script src="app.js"></script>
</body>
</html>`,

    'public/style.css': `* {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
}

body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    min-height: 100vh;
    color: #1c1e21;
}

.container {
    max-width: 600px;
    margin: 0 auto;
    padding: 20px;
}

header {
    text-align: center;
    padding: 40px 0;
    color: white;
}

header h1 {
    font-size: 2.5rem;
    margin-bottom: 10px;
    text-shadow: 2px 2px 4px rgba(0,0,0,0.2);
}

header p {
    font-size: 1.1rem;
    opacity: 0.9;
}

.card {
    background: #ffffff;
    border-radius: 16px;
    padding: 30px;
    margin-bottom: 20px;
    box-shadow: 0 10px 40px rgba(0,0,0,0.2);
}

.card h2 {
    margin-bottom: 20px;
    color: #128C7E;
    font-size: 1.5rem;
}

.form-group {
    margin-bottom: 20px;
}

label {
    display: block;
    margin-bottom: 8px;
    font-weight: 600;
}

input[type="text"] {
    width: 100%;
    padding: 14px 16px;
    border: 2px solid #dddfe2;
    border-radius: 10px;
    font-size: 16px;
    transition: border-color 0.3s;
}

input[type="text"]:focus {
    outline: none;
    border-color: #25D366;
}

small {
    display: block;
    margin-top: 6px;
    color: #65676b;
    font-size: 0.85rem;
}

.upload-area {
    border: 3px dashed #dddfe2;
    border-radius: 12px;
    padding: 40px;
    text-align: center;
    cursor: pointer;
    transition: all 0.3s;
    position: relative;
    overflow: hidden;
}

.upload-area:hover {
    border-color: #25D366;
    background: rgba(37, 211, 102, 0.05);
}

.upload-area.has-image {
    padding: 10px;
    border-style: solid;
    border-color: #25D366;
}

.upload-placeholder {
    pointer-events: none;
}

.upload-placeholder .icon {
    font-size: 3rem;
    display: block;
    margin-bottom: 10px;
}

.preview-image {
    width: 100%;
    max-height: 300px;
    object-fit: cover;
    border-radius: 8px;
}

.btn {
    width: 100%;
    padding: 16px;
    border: none;
    border-radius: 10px;
    font-size: 16px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.3s;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
}

.btn-primary {
    background: #25D366;
    color: white;
}

.btn-primary:hover {
    background: #128C7E;
    transform: translateY(-2px);
    box-shadow: 0 5px 20px rgba(37, 211, 102, 0.4);
}

.btn-secondary {
    background: #65676b;
    color: white;
}

.btn-secondary:hover {
    background: #1c1e21;
}

.btn-copy {
    background: #34B7F1;
    color: white;
    width: auto;
    padding: 10px 20px;
    margin-top: 10px;
}

.btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
    transform: none !important;
}

.hidden {
    display: none !important;
}

.pairing-code-container {
    text-align: center;
    padding: 20px 0;
}

.instruction {
    color: #65676b;
    margin-bottom: 10px;
}

.code-display {
    font-size: 3rem;
    font-weight: bold;
    color: #128C7E;
    letter-spacing: 8px;
    background: #f0f0f0;
    padding: 20px;
    border-radius: 12px;
    font-family: 'Courier New', monospace;
}

.steps-instruction {
    background: #f8f9fa;
    padding: 20px;
    border-radius: 10px;
    margin: 20px 0;
}

.steps-instruction h3 {
    margin-bottom: 15px;
}

.steps-instruction ol {
    padding-left: 20px;
}

.steps-instruction li {
    margin-bottom: 10px;
    line-height: 1.5;
}

.status-indicator {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    padding: 20px;
    color: #65676b;
}

.spinner {
    width: 20px;
    height: 20px;
    border: 3px solid #dddfe2;
    border-top-color: #25D366;
    border-radius: 50%;
    animation: spin 1s linear infinite;
}

@keyframes spin {
    to { transform: rotate(360deg); }
}

.progress-bar {
    height: 6px;
    background: #dddfe2;
    border-radius: 3px;
    overflow: hidden;
    margin-top: 10px;
}

.progress-fill {
    height: 100%;
    background: #25D366;
    width: 0%;
    transition: width 0.5s;
    animation: progress 2s ease-in-out infinite;
}

@keyframes progress {
    0% { width: 0%; }
    50% { width: 70%; }
    100% { width: 100%; }
}

.success-message {
    text-align: center;
    padding: 30px;
}

.success-icon {
    font-size: 5rem;
    margin-bottom: 20px;
}

.success-message p {
    font-size: 1.2rem;
    margin-bottom: 10px;
}

.sub-text {
    color: #65676b;
}

.error-card {
    border-left: 4px solid #ff4444;
}

.error-card h2 {
    color: #ff4444;
}

footer {
    text-align: center;
    padding: 20px;
    color: rgba(255,255,255,0.8);
    font-size: 0.9rem;
}

@media (max-width: 480px) {
    header h1 {
        font-size: 1.8rem;
    }
    
    .code-display {
        font-size: 2rem;
        letter-spacing: 4px;
    }
    
    .card {
        padding: 20px;
    }
}`,

    'public/app.js': `const step1 = document.getElementById('step1');
const step2 = document.getElementById('step2');
const step3 = document.getElementById('step3');
const errorCard = document.getElementById('errorCard');
const uploadArea = document.getElementById('uploadArea');
const fileInput = document.getElementById('dpImage');
const imagePreview = document.getElementById('imagePreview');
const phoneInput = document.getElementById('phoneNumber');
const startBtn = document.getElementById('startBtn');

let currentSessionId = null;
let statusCheckInterval = null;

uploadArea.addEventListener('click', () => fileInput.click());

uploadArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadArea.style.borderColor = '#25D366';
});

uploadArea.addEventListener('dragleave', () => {
    uploadArea.style.borderColor = '#dddfe2';
});

uploadArea.addEventListener('drop', (e) => {
    e.preventDefault();
    const files = e.dataTransfer.files;
    if (files.length > 0) handleFile(files[0]);
});

fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) handleFile(e.target.files[0]);
});

function handleFile(file) {
    if (!file.type.startsWith('image/')) {
        showError('Please select an image file');
        return;
    }
    
    const reader = new FileReader();
    reader.onload = (e) => {
        imagePreview.src = e.target.result;
        imagePreview.hidden = false;
        uploadArea.querySelector('.upload-placeholder').hidden = true;
        uploadArea.classList.add('has-image');
    };
    reader.readAsDataURL(file);
}

async function startSession() {
    const phoneNumber = phoneInput.value.trim();
    const dpImage = fileInput.files[0];

    if (!phoneNumber) {
        showError('Please enter your phone number');
        return;
    }

    const cleanNumber = phoneNumber.replace(/[^0-9]/g, '');
    if (cleanNumber.length < 10) {
        showError('Please enter a valid phone number with country code');
        return;
    }

    startBtn.disabled = true;
    startBtn.textContent = 'Generating...';

    try {
        const formData = new FormData();
        formData.append('phoneNumber', phoneNumber);
        if (dpImage) formData.append('dpImage', dpImage);

        const response = await fetch('/api/start-session', {
            method: 'POST',
            body: formData
        });

        const data = await response.json();
        if (!data.success) throw new Error(data.error || 'Failed to start session');

        currentSessionId = data.sessionId;
        step1.classList.add('hidden');
        step2.classList.remove('hidden');
        
        if (data.pairingCode) {
            document.getElementById('pairingCode').textContent = data.pairingCode;
        }

        startStatusCheck();

    } catch (error) {
        showError(error.message);
        startBtn.disabled = false;
        startBtn.textContent = 'Generate Pairing Code';
    }
}

function copyCode() {
    const code = document.getElementById('pairingCode').textContent;
    navigator.clipboard.writeText(code).then(() => {
        const btn = document.querySelector('.btn-copy');
        btn.textContent = '✅ Copied!';
        setTimeout(() => btn.textContent = '📋 Copy Code', 2000);
    });
}

function startStatusCheck() {
    statusCheckInterval = setInterval(async () => {
        try {
            const response = await fetch(\\`/api/session-status/\\${currentSessionId}\\`);
            const data = await response.json();

            updateStatus(data.status, data.message);

            if (data.status === 'connected' || data.status === 'dp_set') {
                clearInterval(statusCheckInterval);
                setTimeout(() => {
                    step2.classList.add('hidden');
                    step3.classList.remove('hidden');
                }, 1000);
            } else if (data.status === 'disconnected' || data.status === 'dp_failed') {
                clearInterval(statusCheckInterval);
                showError(data.message || 'Connection failed');
            }

            if (data.pairingCode && document.getElementById('pairingCode').textContent === '----') {
                document.getElementById('pairingCode').textContent = data.pairingCode;
            }

        } catch (error) {
            console.error('Status check error:', error);
        }
    }, 2000);
}

function updateStatus(status, message) {
    const statusText = document.getElementById('statusText');
    const statusMap = {
        'connecting': 'Connecting to WhatsApp...',
        'pairing': 'Waiting for you to enter pairing code...',
        'qr': 'Scan QR code (fallback)...',
        'connected': 'Connected! Setting DP...',
        'dp_set': 'Profile picture set!',
        'disconnected': 'Disconnected',
        'dp_failed': 'Failed to set DP'
    };
    
    statusText.textContent = message || statusMap[status] || status;
}

function showError(message) {
    step1.classList.add('hidden');
    step2.classList.add('hidden');
    step3.classList.add('hidden');
    errorCard.classList.remove('hidden');
    document.getElementById('errorMessage').textContent = message;
}

function resetForm() {
    if (statusCheckInterval) clearInterval(statusCheckInterval);
    
    phoneInput.value = '';
    fileInput.value = '';
    imagePreview.hidden = true;
    imagePreview.src = '';
    uploadArea.querySelector('.upload-placeholder').hidden = false;
    uploadArea.classList.remove('has-image');
    
    step1.classList.remove('hidden');
    step2.classList.add('hidden');
    step3.classList.add('hidden');
    errorCard.classList.add('hidden');
    
    startBtn.disabled = false;
    startBtn.textContent = 'Generate Pairing Code';
    document.getElementById('pairingCode').textContent = '----';
    
    currentSessionId = null;
}

window.addEventListener('beforeunload', () => {
    if (statusCheckInterval) clearInterval(statusCheckInterval);
});`
};

// Create all files
console.log('🚀 Creating WhatsApp DP Bot project...\\n');

Object.entries(files).forEach(([filePath, content]) => {
    const dir = path.dirname(filePath);
    if (dir !== '.') {
        fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, content);
    console.log(\\`✅ Created: \\${filePath}\\`);
});

console.log('\\n✨ Project created successfully!');
console.log('\\n📋 Next steps:');
console.log('   1. npm install');
console.log('   2. npm start');
console.log('   3. Open http://localhost:3000');