// ✅ Auto-detect base URL
const API_BASE = window.location.origin; // ඔටෝමැටික්ව Render URL එක ගන්නවා

const step1 = document.getElementById('step1');
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
let currentQrCode = null;

console.log(`🔗 API Base URL: ${API_BASE}`);

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
        showError('කරුණාකර රූප ගොනුවක් තෝරන්න');
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
        showError('කරුණාකර ඔබගේ දුරකථන අංකය ඇතුළත් කරන්න');
        return;
    }

    const cleanNumber = phoneNumber.replace(/[^0-9]/g, '');
    if (cleanNumber.length < 10) {
        showError('කරුණාකර වලංගු දුරකථන අංකයක් ඇතුළත් කරන්න (රට කේතය ඇතුළුව)');
        return;
    }

    startBtn.disabled = true;
    startBtn.textContent = 'ජනනය වෙමින්...';

    try {
        const formData = new FormData();
        formData.append('phoneNumber', phoneNumber);
        if (dpImage) formData.append('dpImage', dpImage);

        console.log(`📤 Sending request to: ${API_BASE}/api/start-session`);

        const response = await fetch(`${API_BASE}/api/start-session`, {
            method: 'POST',
            body: formData
        });

        console.log(`📥 Response status: ${response.status}`);

        if (!response.ok) {
            const errorText = await response.text();
            console.error('❌ Server response:', errorText);
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();
        console.log('📦 Response data:', data);

        if (!data.success) throw new Error(data.error || 'සැසිය ආරම්භ කිරීම අසාර්ථකයි');

        currentSessionId = data.sessionId;
        step1.classList.add('hidden');
        step2.classList.remove('hidden');

        // QR code display
        if (data.qrCode) {
            currentQrCode = data.qrCode;
            let qrContainer = document.getElementById('qrContainer');
            if (!qrContainer) {
                qrContainer = document.createElement('div');
                qrContainer.id = 'qrContainer';
                qrContainer.style.textAlign = 'center';
                qrContainer.style.margin = '20px 0';
                document.querySelector('.pairing-code-container').appendChild(qrContainer);
            }
            qrContainer.innerHTML = `<img src="${data.qrCode}" alt="QR Code" style="max-width: 250px; border-radius: 10px;">`;
            document.getElementById('pairingCode').textContent = '📱 QR Code';
        }

        if (data.pairingCode) {
            document.getElementById('pairingCode').textContent = data.pairingCode;
            const qrContainer = document.getElementById('qrContainer');
            if (qrContainer) qrContainer.innerHTML = '';
        }

        startStatusCheck();

    } catch (error) {
        console.error('❌ Start session error:', error);
        showError(error.message || 'Failed to connect to server. Please check your internet connection.');
        startBtn.disabled = false;
        startBtn.textContent = 'Pairing Code ජනනය කරන්න';
    }
}

function copyCode() {
    const code = document.getElementById('pairingCode').textContent;
    if (code === '----' || code === '📱 QR Code') {
        showError('කිසිදු කේතයක් නොමැත');
        return;
    }
    navigator.clipboard.writeText(code).then(() => {
        const btn = document.querySelector('.btn-copy');
        btn.textContent = '✅ පිටපත් කරන ලදී!';
        setTimeout(() => btn.textContent = '📋 කේතය පිටපත් කරන්න', 2000);
    }).catch(() => {
        // Fallback
        const textArea = document.createElement('textarea');
        textArea.value = code;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        textArea.remove();
        const btn = document.querySelector('.btn-copy');
        btn.textContent = '✅ පිටපත් කරන ලදී!';
        setTimeout(() => btn.textContent = '📋 කේතය පිටපත් කරන්න', 2000);
    });
}

function startStatusCheck() {
    if (statusCheckInterval) clearInterval(statusCheckInterval);
    
    statusCheckInterval = setInterval(async () => {
        try {
            const response = await fetch(`${API_BASE}/api/session-status/${currentSessionId}`);
            if (!response.ok) throw new Error('Status check failed');
            const data = await response.json();

            updateStatus(data.status, data.message);

            if (data.qrCode && data.status === 'qr') {
                currentQrCode = data.qrCode;
                let qrContainer = document.getElementById('qrContainer');
                if (!qrContainer) {
                    qrContainer = document.createElement('div');
                    qrContainer.id = 'qrContainer';
                    qrContainer.style.textAlign = 'center';
                    qrContainer.style.margin = '20px 0';
                    document.querySelector('.pairing-code-container').appendChild(qrContainer);
                }
                qrContainer.innerHTML = `<img src="${data.qrCode}" alt="QR Code" style="max-width: 250px; border-radius: 10px;">`;
                document.getElementById('pairingCode').textContent = '📱 QR Code';
            }

            if (data.pairingCode && document.getElementById('pairingCode').textContent !== data.pairingCode) {
                document.getElementById('pairingCode').textContent = data.pairingCode;
                const qrContainer = document.getElementById('qrContainer');
                if (qrContainer) qrContainer.innerHTML = '';
            }

            if (data.status === 'connected' || data.status === 'dp_set') {
                clearInterval(statusCheckInterval);
                statusCheckInterval = null;
                setTimeout(() => {
                    step2.classList.add('hidden');
                    step3.classList.remove('hidden');
                }, 1000);
            } else if (data.status === 'disconnected' || data.status === 'dp_failed') {
                clearInterval(statusCheckInterval);
                statusCheckInterval = null;
                showError(data.message || 'සම්බන්ධතාවය අසාර්ථකයි');
            }

        } catch (error) {
            console.error('Status check error:', error);
        }
    }, 2000);
}

function updateStatus(status, message) {
    const statusText = document.getElementById('statusText');
    const statusMap = {
        'connecting': 'WhatsApp වෙත සම්බන්ධ වෙමින්...',
        'pairing': 'Pairing code ඇතුළත් කිරීමට රැඳී සිටින්න...',
        'qr': 'QR code එක scan කරන්න',
        'connected': 'සම්බන්ධ විය! DP සකසමින්...',
        'dp_set': '✅ DP සාර්ථකයි!',
        'disconnected': '❌ විසන්ධි විය',
        'dp_failed': '❌ DP සැකසීම අසාර්ථකයි',
        'error': '❌ දෝෂයක්'
    };
    statusText.textContent = message || statusMap[status] || status;
}

function showError(message) {
    step1.classList.add('hidden');
    step2.classList.add('hidden');
    step3.classList.add('hidden');
    errorCard.classList.remove('hidden');
    document.getElementById('errorMessage').textContent = message || 'Unknown error occurred';
}

function resetForm() {
    if (statusCheckInterval) {
        clearInterval(statusCheckInterval);
        statusCheckInterval = null;
    }

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
    startBtn.textContent = 'Pairing Code ජනනය කරන්න';
    document.getElementById('pairingCode').textContent = '----';

    const qrContainer = document.getElementById('qrContainer');
    if (qrContainer) qrContainer.innerHTML = '';
    currentQrCode = null;

    currentSessionId = null;
}

window.addEventListener('beforeunload', () => {
    if (statusCheckInterval) clearInterval(statusCheckInterval);
});
