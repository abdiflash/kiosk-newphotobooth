// CONSTANTS & SYSTEM CONFIGURATION
const GOOGLE_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbz1--xNcCNfK0hOzvzJQbO1LoPP4RDhJFwZRkajKLJuTC0ev8z30YQw3hyLQIg9jr0kEw/exec';
const SYSTEM_SECRET_KEY = "KIOSK_PRO_SECRET_2026";
const CAMERA_API_BASE = 'http://localhost:5000/api/camera';

const DB_NAME = 'PhotoboothKioskDB';
const DB_VERSION = 1;
const STORE_NAME = 'uploadQueue';
let db = null;

const dnpDimensions = {
    '5r_p': { w: 1500, h: 2100, isPortrait: true, printSize: '5in 7in' },
    '5r_l': { w: 2100, h: 1500, isPortrait: false, printSize: '7in 5in' },
    '4r_p': { w: 1200, h: 1800, isPortrait: true, printSize: '4in 6in' },
    '4r_l': { w: 1800, h: 1200, isPortrait: false, printSize: '6in 4in' },
    'strip_2x6': { w: 600, h: 1800, isPortrait: true, printSize: '2in 6in' },
    '6r_p': { w: 1800, h: 2400, isPortrait: true, printSize: '6in 8in' }
};

let currentStream = null, isMirrored = true, capturedPhotos = [], customOverlayImage = null, selectedBgColor = '#ffffff';
let countdownDuration = 3;

// DOM ELEMENTS
const webcam = document.getElementById('webcam'), cameraWrapper = document.getElementById('cameraWrapper'), liveOverlay = document.getElementById('liveOverlay'), safeZoneGuide = document.getElementById('safeZoneGuide'), cameraSelect = document.getElementById('cameraSelect'), mirrorBtn = document.getElementById('mirrorBtn'), fullscreenBtn = document.getElementById('fullscreenBtn'), startBtn = document.getElementById('startBtn'), flashElem = document.getElementById('flashElem'), countdownElem = document.getElementById('countdownElem'), poseFormat = document.getElementById('poseFormat'), dnpSizeSelect = document.getElementById('dnpSizeSelect'), safeAreaMargin = document.getElementById('safeAreaMargin'), filterSelect = document.getElementById('filterSelect'), overlayInput = document.getElementById('overlayInput'), eventTitle = document.getElementById('eventTitle'), eventSub = document.getElementById('eventSub'), resultModal = document.getElementById('resultModal'), settingsModal = document.getElementById('settingsModal'), settingsBtn = document.getElementById('settingsBtn'), closeSettingsBtn = document.getElementById('closeSettingsBtn'), saveSettingsBtn = document.getElementById('saveSettingsBtn'), inputDriveLink = document.getElementById('inputDriveLink'), inputEventName = document.getElementById('inputEventName'), passStatusText = document.getElementById('passStatusText'), customColorPicker = document.getElementById('customColorPicker'), outputCanvas = document.getElementById('outputCanvas'), closeModalBtn = document.getElementById('closeModalBtn'), printBtn = document.getElementById('printBtn'), downloadPngBtn = document.getElementById('downloadPngBtn'), downloadZipBtn = document.getElementById('downloadZipBtn'), qrcodeContainer = document.getElementById('qrcode'), qrStatus = document.getElementById('qrStatus'), queueBadge = document.getElementById('queueBadge');

const isoSelect = document.getElementById('isoSelect'), apertureSelect = document.getElementById('apertureSelect'), shutterSelect = document.getElementById('shutterSelect');
const licenseBadge = document.getElementById('licenseBadge'), activatePassBtn = document.getElementById('activatePassBtn'), activationModal = document.getElementById('activationModal'), closeActivationBtn = document.getElementById('closeActivationBtn'), submitPassBtn = document.getElementById('submitPassBtn'), inputPassCode = document.getElementById('inputPassCode'), midtransPayBtn = document.getElementById('midtransPayBtn');
const mode1Btn = document.getElementById('mode1Btn'), mode2Btn = document.getElementById('mode2Btn');

// INDEXEDDB OFFLINE QUEUE SYSTEM
function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = (e) => {
            const dbInstance = e.target.result;
            if (!dbInstance.objectStoreNames.contains(STORE_NAME)) {
                dbInstance.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
            }
        };
        request.onsuccess = (e) => {
            db = e.target.result;
            resolve(db);
            updateQueueBadge();
            processOfflineQueue();
        };
        request.onerror = (e) => reject(e.target.error);
    });
}

async function addToQueue(data) {
    if (!db) await initDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const req = store.add({ ...data, timestamp: Date.now() });
        req.onsuccess = () => {
            updateQueueBadge();
            resolve(req.result);
        };
        req.onerror = () => reject(req.error);
    });
}

async function getQueue() {
    if (!db) await initDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function removeFromQueue(id) {
    if (!db) await initDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const req = store.delete(id);
        req.onsuccess = () => {
            updateQueueBadge();
            resolve();
        };
        req.onerror = () => reject(req.error);
    });
}

let isProcessingQueue = false;
async function processOfflineQueue() {
    if (isProcessingQueue || !navigator.onLine) return;
    isProcessingQueue = true;

    try {
        const queue = await getQueue();
        if (queue.length > 0) {
            for (const item of queue) {
                try {
                    const res = await fetch(GOOGLE_SCRIPT_URL, {
                        method: 'POST',
                        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                        body: JSON.stringify({
                            image: item.image,
                            masterFolderId: item.masterFolderId,
                            eventName: item.eventName
                        })
                    });
                    const data = await res.json();
                    if (data.status === 'success') {
                        await removeFromQueue(item.id);
                    }
                } catch (err) {
                    console.warn("Queue upload paused:", err);
                    break;
                }
            }
        }
    } catch (err) {
        console.error("Queue process error:", err);
    } finally {
        isProcessingQueue = false;
        updateQueueBadge();
    }
}

async function updateQueueBadge() {
    if (!queueBadge) return;
    try {
        const queue = await getQueue();
        if (queue.length > 0) {
            queueBadge.style.display = 'inline-flex';
            queueBadge.textContent = `🔄 Queue: ${queue.length}`;
        } else {
            queueBadge.style.display = 'none';
        }
    } catch (e) {
        console.error(e);
    }
}

function initKioskLockdown() {
    document.addEventListener('contextmenu', e => e.preventDefault());
    document.addEventListener('dragstart', e => e.preventDefault());
    document.addEventListener('touchmove', e => {
        if (e.touches.length > 1) e.preventDefault();
    }, { passive: false });

    let lastTouchEnd = 0;
    document.addEventListener('touchend', e => {
        const now = Date.now();
        if (now - lastTouchEnd <= 300) e.preventDefault();
        lastTouchEnd = now;
    }, false);

    document.addEventListener('keydown', e => {
        if (
            e.key === 'F12' ||
            (e.ctrlKey && e.key === 'r') ||
            (e.ctrlKey && e.shiftKey && (e.key === 'I' || e.key === 'J')) ||
            (e.ctrlKey && e.key === 'u')
        ) {
            e.preventDefault();
        }
    });
}

function extractFolderId(input) {
    if (!input) return "";
    const match = input.match(/folders\/([a-zA-Z0-9_-]+)/);
    return match ? match[1] : input.trim();
}

function isPassActive() {
    const expiryStr = localStorage.getItem('cfg_expiry_date');
    if (!expiryStr) return false;
    return new Date().getTime() < new Date(expiryStr).getTime();
}

function updateLicenseStatusUI() {
    if (isPassActive()) {
        const expiryDate = new Date(localStorage.getItem('cfg_expiry_date'));
        const diffMs = expiryDate - new Date();
        const minsLeft = Math.max(0, Math.ceil(diffMs / (1000 * 60)));
        
        if (minsLeft <= 60) {
            licenseBadge.className = 'license-badge active';
            licenseBadge.innerHTML = `🟢 Pass Active (${minsLeft}m Left)`;
        } else {
            const hoursLeft = Math.floor(minsLeft / 60);
            licenseBadge.className = 'license-badge active';
            licenseBadge.innerHTML = `🟢 Pass Active (${hoursLeft}h Left)`;
        }
    } else {
        licenseBadge.className = 'license-badge free';
        licenseBadge.innerHTML = `🟠 Free Mode`;
    }
    updateEventSettingsPassStatus();
}

function updateEventSettingsPassStatus() {
    if (!passStatusText) return;
    const expiryStr = localStorage.getItem('cfg_expiry_date');
    const now = Date.now();

    if (expiryStr && new Date(expiryStr).getTime() > now) {
        const dateObj = new Date(expiryStr);
        const formattedDate = dateObj.toLocaleString('en-US', {
            day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit'
        });
        passStatusText.innerHTML = `
            <span style="color: #10b981; font-weight: bold;">🟢 Pass Active</span><br>
            <span style="color: #cbd5e1; font-size: 0.8rem;">Valid until: ${formattedDate}</span>
        `;
    } else {
        passStatusText.innerHTML = `
            <span style="color: #f59e0b; font-weight: bold;">🟠 Free Mode (Watermark Active)</span><br>
            <span style="color: #94a3b8; font-size: 0.8rem;">No expiry limit. Purchase Pass to remove watermark.</span>
        `;
    }
}

function handleUrlParameters() {
    const params = new URLSearchParams(window.location.search);
    const devKey = params.get('dev');
    const passKey = params.get('pass');

    if (devKey === 'superadmin2026') {
        localStorage.setItem('cfg_expiry_date', '2030-12-31T23:59:59.000Z');
        alert("Superadmin Developer Mode Active until 2030!");
        window.history.replaceState({}, document.title, window.location.pathname);
    } else if (passKey) {
        verifyAndApplyPassCode(passKey);
        window.history.replaceState({}, document.title, window.location.pathname);
    }
    updateLicenseStatusUI();
}

async function verifyAndApplyPassCode(code) {
    const cleanCode = code.trim().toUpperCase();
    if (!cleanCode) {
        alert("License code cannot be empty.");
        return false;
    }

    if (cleanCode === 'SUPERADMIN2026') {
        localStorage.setItem('cfg_expiry_date', '2030-12-31T23:59:59.000Z');
        alert("Developer Access Activated (2030)!");
        updateLicenseStatusUI();
        return true;
    }

    if (cleanCode === 'TEST30M' || cleanCode === 'TEST30MIN') {
        addPassMinutes(30);
        alert("🎉 Passcode Testing 30 Menit Berhasil Diaktifkan!");
        return true;
    }

    const match = cleanCode.match(/^PASS(\d+)-([A-Z0-9]{4})-([A-Z0-9]{4})$/);
    if (!match) {
        alert("Invalid Pass Code format!");
        return false;
    }

    const hours = parseInt(match[1], 10);
    const salt = match[2];
    const checksum = match[3];

    const input = `${hours}-${salt}-${SYSTEM_SECRET_KEY}`;
    const msgBuffer = new TextEncoder().encode(input);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const calculatedChecksum = hashArray.map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 4).toUpperCase();

    if (checksum === calculatedChecksum) {
        addPassHours(hours);
        alert(`🎉 Valid Pass Code! Duration added: +${hours} Hours.`);
        return true;
    } else {
        alert("Invalid License Code.");
        return false;
    }
}

function addPassMinutes(minsToAdd) {
    const expiryStr = localStorage.getItem('cfg_expiry_date');
    const currentExpiry = expiryStr ? new Date(expiryStr).getTime() : 0;
    const now = Date.now();

    const baseTime = (currentExpiry > now) ? currentExpiry : now;
    const newExpiry = new Date(baseTime + (minsToAdd * 60 * 1000)).toISOString();

    localStorage.setItem('cfg_expiry_date', newExpiry);
    updateLicenseStatusUI();
}

function addPassHours(hoursToAdd) {
    addPassMinutes(hoursToAdd * 60);
}

function activatePassByAmount(paidAmount = 50000) {
    const multiplier = Math.max(1, Math.floor(paidAmount / 50000));
    const hoursToAdd = multiplier * 24;
    addPassHours(hoursToAdd);

    if (activationModal.classList.contains('active')) activationModal.classList.remove('active');
    alert(`🎉 Payment Successful! Duration added: +${hoursToAdd} Hours.`);
}

async function triggerMidtransPayment() {
    const activeBtn = midtransPayBtn;
    const originalText = activeBtn ? activeBtn.innerText : '';

    try {
        if (activeBtn) {
            activeBtn.innerText = 'Processing...';
            activeBtn.disabled = true;
        }

        const response = await fetch('https://edueasy.id/wp-json/photobooth/v1/create-snap-token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });

        if (!response.ok) throw new Error(`Server status ${response.status}`);
        const data = await response.json();

        if (!data || !data.token) {
            alert("Failed to retrieve transaction token.");
            return;
        }

        if (typeof snap !== 'undefined' && snap.pay) {
            window.snap.pay(data.token, {
                onSuccess: function(result) {
                    const grossAmount = parseInt(result.gross_amount) || 50000;
                    activatePassByAmount(grossAmount);
                },
                onPending: function() { alert("Waiting for payment..."); },
                onError: function() { alert("Payment transaction failed."); }
            });
        } else {
            alert("Midtrans Snap library is not ready.");
        }

    } catch (err) {
        console.error("Midtrans Error:", err);
        alert("Failed to connect to payment server.");
    } finally {
        if (activeBtn) {
            activeBtn.innerText = originalText;
            activeBtn.disabled = false;
        }
    }
}

if (midtransPayBtn) midtransPayBtn.addEventListener('click', triggerMidtransPayment);
if (activatePassBtn) activatePassBtn.addEventListener('click', () => activationModal.classList.add('active'));
if (closeActivationBtn) closeActivationBtn.addEventListener('click', () => activationModal.classList.remove('active'));

if (submitPassBtn) {
    submitPassBtn.addEventListener('click', async () => {
        const isSuccess = await verifyAndApplyPassCode(inputPassCode.value);
        if (isSuccess) {
            inputPassCode.value = '';
            activationModal.classList.remove('active');
        }
    });
}

function setActiveModeBtn(selectedBtn) {
    [mode1Btn, mode2Btn].forEach(b => b.classList.remove('active'));
    if (selectedBtn) selectedBtn.classList.add('active');
}

if (mode1Btn) {
    mode1Btn.addEventListener('click', () => {
        setActiveModeBtn(mode1Btn);
        dnpSizeSelect.value = '5r_p';
        countdownDuration = 0;
        isMirrored = false;
        webcam.classList.remove('mirrored');
        updateLivePreviewLayout();
        startCamera(null, 'environment');
    });
}

if (mode2Btn) {
    mode2Btn.addEventListener('click', () => {
        setActiveModeBtn(mode2Btn);
        dnpSizeSelect.value = '5r_p';
        countdownDuration = 3;
        isMirrored = true;
        webcam.classList.add('mirrored');
        updateLivePreviewLayout();
        startCamera(null, 'user');
    });
}

function updateLivePreviewLayout() {
    const config = dnpDimensions[dnpSizeSelect.value] || dnpDimensions['5r_p'];
    const ratio = config.w / config.h;

    cameraWrapper.style.aspectRatio = `${config.w} / ${config.h}`;

    if (config.isPortrait) {
        cameraWrapper.style.height = '55vh';
        cameraWrapper.style.width = `calc(55vh * ${ratio})`;
        cameraWrapper.style.maxWidth = '100%';
        cameraWrapper.style.maxHeight = 'none';
    } else {
        cameraWrapper.style.width = '100%';
        cameraWrapper.style.height = 'auto';
        cameraWrapper.style.maxHeight = '55vh';
        cameraWrapper.style.maxWidth = '100%';
    }

    const marginPx = parseInt(safeAreaMargin.value) || 0;
    const percentX = (marginPx / config.w) * 100;
    const percentY = (marginPx / config.h) * 100;

    safeZoneGuide.style.top = `${percentY}%`;
    safeZoneGuide.style.bottom = `${percentY}%`;
    safeZoneGuide.style.left = `${percentX}%`;
    safeZoneGuide.style.right = `${percentX}%`;

    saveSettings();
}

async function applyCameraSettings() {
    const iso = isoSelect.value;
    const aperture = apertureSelect.value;
    const shutter = shutterSelect.value;

    if (currentStream) {
        const videoTrack = currentStream.getVideoTracks()[0];
        if (videoTrack && typeof videoTrack.getCapabilities === 'function') {
            const capabilities = videoTrack.getCapabilities();
            const advanced = {};

            if (iso !== 'auto' && capabilities.iso) {
                advanced.iso = Number(iso);
            }
            if (shutter !== 'auto' && capabilities.exposureTime) {
                try {
                    const shutterSec = eval(shutter);
                    advanced.exposureTime = shutterSec;
                } catch (e) {
                    console.warn("Format shutter speed tidak valid:", shutter);
                }
            }

            if (Object.keys(advanced).length > 0) {
                try {
                    await videoTrack.applyConstraints({ advanced: [advanced] });
                } catch (err) {
                    console.warn("MediaTrack constraints tidak dapat diterapkan:", err);
                }
            }
        }
    }

    try {
        fetch(`${CAMERA_API_BASE}/settings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ iso, aperture, shutter })
        }).catch(() => {});
    } catch (err) {
        console.warn("API Local backend kamera tidak merespon:", err);
    }

    saveSettings();
}

function saveSettings() {
    localStorage.setItem('pb_eventTitle', eventTitle.value);
    localStorage.setItem('pb_eventSub', eventSub.value);
    localStorage.setItem('pb_dnpSize', dnpSizeSelect.value);
    localStorage.setItem('pb_poseFormat', poseFormat.value);
    localStorage.setItem('pb_safeMargin', safeAreaMargin.value);
    localStorage.setItem('pb_bgColor', selectedBgColor);
    localStorage.setItem('pb_filter', filterSelect.value);
    localStorage.setItem('pb_iso', isoSelect.value);
    localStorage.setItem('pb_aperture', apertureSelect.value);
    localStorage.setItem('pb_shutter', shutterSelect.value);
}

function loadSettings() {
    handleUrlParameters();
    if (localStorage.getItem('pb_eventTitle') !== null) eventTitle.value = localStorage.getItem('pb_eventTitle');
    if (localStorage.getItem('pb_eventSub') !== null) eventSub.value = localStorage.getItem('pb_eventSub');
    if (localStorage.getItem('pb_dnpSize')) dnpSizeSelect.value = localStorage.getItem('pb_dnpSize');
    if (localStorage.getItem('pb_poseFormat')) poseFormat.value = localStorage.getItem('pb_poseFormat');
    if (localStorage.getItem('pb_safeMargin')) safeAreaMargin.value = localStorage.getItem('pb_safeMargin');
    if (localStorage.getItem('pb_filter')) filterSelect.value = localStorage.getItem('pb_filter');
    if (localStorage.getItem('pb_iso')) isoSelect.value = localStorage.getItem('pb_iso');
    if (localStorage.getItem('pb_aperture')) apertureSelect.value = localStorage.getItem('pb_aperture');
    if (localStorage.getItem('pb_shutter')) shutterSelect.value = localStorage.getItem('pb_shutter');
    if (localStorage.getItem('pb_bgColor')) {
        selectedBgColor = localStorage.getItem('pb_bgColor');
        customColorPicker.value = selectedBgColor.startsWith('#') ? selectedBgColor : '#ffffff';
    }
    updateLivePreviewLayout();
}

[eventTitle, eventSub, dnpSizeSelect, poseFormat, safeAreaMargin, filterSelect].forEach(elem => {
    if (elem) {
        elem.addEventListener('input', updateLivePreviewLayout);
        elem.addEventListener('change', updateLivePreviewLayout);
    }
});

[isoSelect, apertureSelect, shutterSelect].forEach(elem => {
    if (elem) {
        elem.addEventListener('change', applyCameraSettings);
    }
});

document.querySelectorAll('.color-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.color-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        selectedBgColor = btn.dataset.color;
        saveSettings();
    });
});

if (customColorPicker) {
    customColorPicker.addEventListener('input', (e) => {
        document.querySelectorAll('.color-btn').forEach(b => b.classList.remove('active'));
        selectedBgColor = e.target.value;
        saveSettings();
    });
}

if (settingsBtn) {
    settingsBtn.addEventListener('click', () => {
        inputDriveLink.value = localStorage.getItem('cfg_drive_link') || '';
        inputEventName.value = localStorage.getItem('cfg_event_name') || eventTitle.value || '';
        updateEventSettingsPassStatus();
        settingsModal.classList.add('active');
    });
}

if (closeSettingsBtn) closeSettingsBtn.addEventListener('click', () => settingsModal.classList.remove('active'));

if (saveSettingsBtn) {
    saveSettingsBtn.addEventListener('click', () => {
        const linkVal = inputDriveLink.value.trim();
        const eventVal = inputEventName.value.trim();

        if (!linkVal) { alert("Google Drive Master Folder link is required!"); return; }

        localStorage.setItem('cfg_drive_link', linkVal);
        localStorage.setItem('cfg_event_name', eventVal || 'Photobooth Event');

        if (eventVal) { eventTitle.value = eventVal; saveSettings(); }

        alert("Settings saved successfully!");
        settingsModal.classList.remove('active');
        updateLicenseStatusUI();
    });
}

async function initCameras() {
    loadSettings();
    try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = devices.filter(d => d.kind === 'videoinput');
        cameraSelect.innerHTML = '';
        videoDevices.forEach((device, idx) => {
            const opt = document.createElement('option');
            opt.value = device.deviceId;
            opt.text = device.label || `Camera ${idx + 1}`;
            cameraSelect.appendChild(opt);
        });
        if (videoDevices.length > 0) startCamera(videoDevices[0].deviceId);
    } catch (err) { alert('Failed to detect cameras: ' + err.message); }
}

async function startCamera(deviceId, facingMode = null) {
    if (currentStream) {
        currentStream.getTracks().forEach(t => t.stop());
        currentStream = null;
    }
    webcam.srcObject = null;

    let primaryConfig = {
        width: { ideal: 3840, min: 1920 },
        height: { ideal: 2160, min: 1080 }
    };

    if (facingMode) {
        primaryConfig.facingMode = { ideal: facingMode };
    } else if (deviceId) {
        primaryConfig.deviceId = { exact: deviceId };
    }

    try {
        currentStream = await navigator.mediaDevices.getUserMedia({ video: primaryConfig });
        webcam.srcObject = currentStream;
        applyCameraSettings();
    } catch (err) {
        console.warn("High-res camera request failed, attempting standard Full HD fallback:", err);
        try {
            let fallbackConfig = {
                width: { ideal: 1920 },
                height: { ideal: 1080 }
            };
            if (facingMode) fallbackConfig.facingMode = facingMode;
            else if (deviceId) fallbackConfig.deviceId = deviceId;

            currentStream = await navigator.mediaDevices.getUserMedia({ video: fallbackConfig });
            webcam.srcObject = currentStream;
            applyCameraSettings();
        } catch (fallbackErr) {
            try {
                let minimalConfig = facingMode ? { facingMode: facingMode } : (deviceId ? { deviceId: deviceId } : true);
                currentStream = await navigator.mediaDevices.getUserMedia({ video: minimalConfig });
                webcam.srcObject = currentStream;
                applyCameraSettings();
            } catch (finalErr) {
                console.error("Camera access failed completely:", finalErr);
                alert('Failed to access camera: ' + finalErr.message);
            }
        }
    }
}

if (cameraSelect) cameraSelect.addEventListener('change', () => startCamera(cameraSelect.value));
if (mirrorBtn) mirrorBtn.addEventListener('click', () => { isMirrored = !isMirrored; webcam.classList.toggle('mirrored', isMirrored); });
if (fullscreenBtn) {
    fullscreenBtn.addEventListener('click', () => {
        if (!document.fullscreenElement) document.documentElement.requestFullscreen();
        else document.exitFullscreen();
    });
}

if (overlayInput) {
    overlayInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (evt) => {
                const img = new Image();
                img.onload = () => { customOverlayImage = img; liveOverlay.src = evt.target.result; liveOverlay.style.display = 'block'; };
                img.src = evt.target.result;
            };
            reader.readAsDataURL(file);
        }
    });
}

if (startBtn) {
    startBtn.addEventListener('click', async () => {
        capturedPhotos = [];
        startBtn.style.display = 'none';
        const totalPoses = parseInt(poseFormat.value);

        for (let i = 0; i < totalPoses; i++) {
            if (countdownDuration > 0) {
                await runCountdown(countdownDuration);
            }
            triggerFlash();
            captureFrame();
            if (i < totalPoses - 1) await new Promise(r => setTimeout(r, 1500));
        }
        startBtn.style.display = 'inline-flex';
        buildPhotostrip();
    });
}

function runCountdown(sec) {
    return new Promise((resolve) => {
        countdownElem.style.display = 'block';
        let c = sec; countdownElem.textContent = c;
        const t = setInterval(() => {
            c--;
            if (c > 0) countdownElem.textContent = c;
            else { clearInterval(t); countdownElem.style.display = 'none'; resolve(); }
        }, 1000);
    });
}

function triggerFlash() {
    flashElem.classList.add('active');
    setTimeout(() => flashElem.classList.remove('active'), 350);
}

function captureFrame() {
    const canvas = document.createElement('canvas');
    const vW = webcam.videoWidth || 1920;
    const vH = webcam.videoHeight || 1080;
    canvas.width = vW;
    canvas.height = vH;
    
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    if (isMirrored) { ctx.translate(canvas.width, 0); ctx.scale(-1, 1); }
    ctx.filter = filterSelect.value;
    ctx.drawImage(webcam, 0, 0, canvas.width, canvas.height);
    capturedPhotos.push(canvas.toDataURL('image/png', 1.0));
}

function buildPhotostrip() {
    const canvas = outputCanvas; const ctx = canvas.getContext('2d');
    const config = dnpDimensions[dnpSizeSelect.value] || dnpDimensions['5r_p'];
    canvas.width = config.w; canvas.height = config.h;

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    ctx.fillStyle = selectedBgColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    let loadedCount = 0; const loadedImages = [];
    capturedPhotos.forEach((src, idx) => {
        const img = new Image();
        img.onload = () => {
            loadedImages[idx] = img; loadedCount++;
            if (loadedCount === capturedPhotos.length) drawLayout(ctx, canvas, loadedImages, config.isPortrait);
        };
        img.src = src;
    });
}

function drawLayout(ctx, canvas, images, isPortrait) {
    const count = images.length;
    const margin = parseInt(safeAreaMargin.value) || 40;
    const hasText = eventTitle.value.trim() !== '' || eventSub.value.trim() !== '';
    const footerH = hasText ? Math.round(canvas.height * 0.10) : 0;

    if (count === 1) {
        drawCroppedImage(ctx, images[0], margin, margin, canvas.width - (margin * 2), canvas.height - footerH - (margin * 2));
    } else if (count === 3) {
        const availH = canvas.height - footerH - (margin * 4);
        const photoH = availH / 3;
        const photoW = canvas.width - (margin * 2);
        images.forEach((img, i) => drawCroppedImage(ctx, img, margin, margin + i * (photoH + margin), photoW, photoH));
    } else if (count === 4) {
        const availH = canvas.height - footerH - (margin * 3);
        const photoW = (canvas.width - (margin * 3)) / 2;
        const photoH = availH / 2;
        const pos = [
            { x: margin, y: margin },
            { x: margin * 2 + photoW, y: margin },
            { x: margin, y: margin * 2 + photoH },
            { x: margin * 2 + photoW, y: margin * 2 + photoH }
        ];
        images.forEach((img, i) => drawCroppedImage(ctx, img, pos[i].x, pos[i].y, photoW, photoH));
    }

    if (customOverlayImage) ctx.drawImage(customOverlayImage, 0, 0, canvas.width, canvas.height);

    if (hasText) {
        const footerY = canvas.height - (footerH / 2);
        ctx.textAlign = 'center';
        ctx.fillStyle = (selectedBgColor.toLowerCase() === '#ffffff') ? '#090d16' : '#ffffff';
        const titleFontSize = Math.round(canvas.width * 0.035);
        const subFontSize = Math.round(canvas.width * 0.021);

        if (eventTitle.value.trim() !== '') {
            ctx.font = `bold ${titleFontSize}px Plus Jakarta Sans`;
            ctx.fillText(eventTitle.value.toUpperCase(), canvas.width / 2, footerY - Math.round(titleFontSize * 0.2));
        }
        if (eventSub.value.trim() !== '') {
            ctx.font = `500 ${subFontSize}px Plus Jakarta Sans`;
            ctx.fillText(eventSub.value, canvas.width / 2, footerY + Math.round(subFontSize * 1.2));
        }
    }

    if (!isPassActive()) {
        drawWatermark(ctx, canvas.width, canvas.height);
    }

    resultModal.classList.add('active');
    generateOnlineQRCode();
}

function drawWatermark(ctx, width, height) {
    ctx.save();
    ctx.rotate(-Math.PI / 6);
    ctx.font = `bold ${Math.round(width * 0.045)}px Plus Jakarta Sans`;
    ctx.fillStyle = 'rgba(239, 68, 68, 0.35)';
    ctx.textAlign = 'center';
    
    const stepX = Math.round(width * 0.4);
    const stepY = Math.round(height * 0.2);
    for (let y = -height; y < height * 2; y += stepY) {
        for (let x = -width; x < width * 2; x += stepX) {
            ctx.fillText('www.edueasy.id', x, y);
        }
    }
    ctx.restore();

    ctx.fillStyle = 'rgba(15, 23, 42, 0.88)';
    ctx.fillRect(0, height - 50, width, 50);
    ctx.font = '700 15px Plus Jakarta Sans';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.fillText('DEMO MODE — BUY PASS TO REMOVE WATERMARK: WWW.EDUEASY.ID', width / 2, height - 20);
}

function drawCroppedImage(ctx, img, x, y, w, h) {
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    const imgAspect = img.width / img.height, targetAspect = w / h;
    let sx, sy, sw, sh;
    if (imgAspect > targetAspect) {
        sh = img.height; sw = img.height * targetAspect; sx = (img.width - sw) / 2; sy = 0;
    } else {
        sw = img.width; sh = img.width / targetAspect; sx = 0; sy = (img.height - sh) / 2;
    }
    ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
}

async function generateOnlineQRCode() {
    const rawDriveLink = localStorage.getItem('cfg_drive_link') || "";
    const activeFolderId = extractFolderId(rawDriveLink);
    const activeEventName = localStorage.getItem('cfg_event_name') || eventTitle.value || "Photobooth Event";

    if (!activeFolderId) {
        qrcodeContainer.innerHTML = '<span style="color:#ef4444; font-size:11px; font-weight:bold;">⚠️ Link Drive Belum Diisi!</span>';
        qrStatus.textContent = "DRIVE FOLDER BELUM SET";
        return;
    }

    const folderUrl = `https://drive.google.com/drive/folders/${activeFolderId}`;

    qrcodeContainer.innerHTML = '';
    let qrRendered = false;

    if (typeof QRCode !== 'undefined') {
        try {
            new QRCode(qrcodeContainer, { 
                text: folderUrl, 
                width: 120, 
                height: 120, 
                correctLevel: QRCode.CorrectLevel.L 
            });
            qrRendered = true;
        } catch (e) {
            console.warn("QRCode JS Render Warning, switching to Image API Fallback:", e);
        }
    }

    if (!qrRendered) {
        const qrImg = document.createElement('img');
        qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${encodeURIComponent(folderUrl)}`;
        qrImg.style.width = '120px';
        qrImg.style.height = '120px';
        qrImg.style.borderRadius = '4px';
        qrImg.alt = 'QR Code Drive';
        qrcodeContainer.appendChild(qrImg);
    }

    qrStatus.textContent = "🔄 MENGUNGGAH KE DRIVE...";

    try {
        const webCanvas = document.createElement('canvas');
        const targetW = 1600;
        const targetH = Math.round((outputCanvas.height / outputCanvas.width) * targetW);
        webCanvas.width = targetW; 
        webCanvas.height = targetH;
        
        const webCtx = webCanvas.getContext('2d');
        webCtx.imageSmoothingEnabled = true;
        webCtx.imageSmoothingQuality = 'high';
        webCtx.drawImage(outputCanvas, 0, 0, targetW, targetH);
        
        const base64Image = webCanvas.toDataURL('image/jpeg', 0.85);

        if (!navigator.onLine) {
            await addToQueue({ image: base64Image, masterFolderId: activeFolderId, eventName: activeEventName });
            qrStatus.textContent = "📦 OFFLINE (TERSIMPAN DI QUEUE)";
            return;
        }

        const res = await fetch(GOOGLE_SCRIPT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify({
                image: base64Image,
                masterFolderId: activeFolderId,
                eventName: activeEventName
            })
        });

        const data = await res.json();
        if (data.status === 'success') {
            qrStatus.textContent = "✅ FOTO TERKIRIM KE DRIVE";
        } else {
            throw new Error(data.message || "Gagal mengunggah");
        }
    } catch (err) {
        console.error("Upload Drive Error:", err);
        try {
            const base64Image = outputCanvas.toDataURL('image/jpeg', 0.85);
            await addToQueue({ image: base64Image, masterFolderId: activeFolderId, eventName: activeEventName });
            qrStatus.textContent = "📦 TERSIMPAN DI QUEUE (AKAN DIPROSES)";
        } catch (e) {
            qrStatus.textContent = "❌ GAGAL UPLOAD";
        }
    }
}

if (printBtn) {
    printBtn.addEventListener('click', () => {
        const printArea = document.getElementById('printArea');
        const config = dnpDimensions[dnpSizeSelect.value] || dnpDimensions['5r_p'];
        document.getElementById('dynamicPrintStyle').innerHTML = `@page { size: ${config.printSize}; margin: 0; }`;
        printArea.innerHTML = '';
        const img = new Image();
        img.onload = () => { printArea.appendChild(img); setTimeout(() => window.print(), 300); };
        img.src = outputCanvas.toDataURL('image/png');
    });
}

if (downloadPngBtn) {
    downloadPngBtn.addEventListener('click', () => {
        const link = document.createElement('a');
        link.download = `photobooth-${Date.now()}.png`;
        link.href = outputCanvas.toDataURL();
        link.click();
    });
}

if (downloadZipBtn) {
    downloadZipBtn.addEventListener('click', () => {
        if (typeof JSZip === 'undefined' || typeof saveAs === 'undefined') {
            alert("Library ZIP belum siap.");
            return;
        }
        const zip = new JSZip();
        const folder = zip.folder("photobooth_session");
        folder.file("photostrip_full.png", outputCanvas.toDataURL().split(',')[1], { base64: true });
        capturedPhotos.forEach((photo, idx) => folder.file(`pose_${idx + 1}.png`, photo.split(',')[1], { base64: true }));
        zip.generateAsync({ type: "blob" }).then((blob) => saveAs(blob, `photobooth-session-${Date.now()}.zip`));
    });
}

if (closeModalBtn) closeModalBtn.addEventListener('click', () => { capturedPhotos = []; resultModal.classList.remove('active'); });

window.addEventListener('online', processOfflineQueue);
setInterval(processOfflineQueue, 15000);

window.addEventListener('load', () => {
    initCameras();
    initDB();
    initKioskLockdown();
});
