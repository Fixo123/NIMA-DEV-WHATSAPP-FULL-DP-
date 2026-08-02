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

        const response = await fetch('/api/start-session', {
            method: 'POST',
            body: formData
        });

        const data = await response.json();
        if (!data.success) throw new Error(data.error || 'සැසිය ආරම්භ කිරීම අසාර්ථකයි');

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
        startBtn.textContent = 'Pairing Code ජනනය කරන්න';
    }
}

function copyCode() {
    const code = document.getElementById('pairingCode').textContent;
    navigator.clipboard.writeText(code).then(() => {
        const btn = document.querySelector('.btn-copy');
        btn.textContent = '✅ පිටපත් කරන ලදී!';
        setTimeout(() => btn.textContent = '📋 කේතය පිටපත් කරන්න', 2000);
    });
}

function startStatusCheck() {
    statusCheckInterval = setInterval(async () => {
        try {
            const response = await fetch(`/api/session-status/${currentSessionId}`);
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
                showError(data.message || 'සම්බන්ධතාවය අසාර්ථකයි');
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
        'connecting': 'WhatsApp වෙත සම්බන්ධ වෙමින්...',
        'pairing': 'Pairing code ඇතුළත් කිරීමට රැඳී සිටින්න...',
        'qr': 'QR කේතය scan කරන්න (විකල්ප)...',
        'connected': 'සම්බන්ධ විය! DP සකසමින්...',
        'dp_set': 'පැතිකඩ පින්තූරය සකසා ඇත!',
        'disconnected': 'විසන්ධි විය',
        'dp_failed': 'DP සැකසීම අසාර්ථකයි'
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
    startBtn.textContent = 'Pairing Code ජනනය කරන්න';
    document.getElementById('pairingCode').textContent = '----';

    currentSessionId = null;
}

window.addEventListener('beforeunload', () => {
    if (statusCheckInterval) clearInterval(statusCheckInterval);
});
