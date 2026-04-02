const state = {
    settings: null,
    items: [],
    selectedId: null,
    isProcessing: false,
    human: {
        instance: null,
        ready: false,
        available: false,
        loading: false,
        error: '',
        detector: 'uninitialized'
    },
    ui: {
        reprocessTimer: null,
        isDraggingOutput: false,
        dragStartClientX: 0,
        dragStartClientY: 0,
        dragStartOffsetX: 0,
        dragStartOffsetY: 0
    }
};

const elements = {
    addFilesButton: document.getElementById('add-files-button'),
    runExportButton: document.getElementById('run-export-button'),
    dropZone: document.getElementById('drop-zone'),
    imageList: document.getElementById('image-list'),
    progressBar: document.getElementById('progress-bar'),
    progressLabel: document.getElementById('progress-label'),
    statusSummary: document.getElementById('status-summary'),
    sourcePreviewImage: document.getElementById('source-preview-image'),
    outputPreviewImage: document.getElementById('output-preview-image'),
    outputPreviewSurface: document.getElementById('output-preview-surface'),
    outputPreviewFrame: null,
    sourceOverlay: document.getElementById('source-overlay'),
    emptySource: document.getElementById('empty-source'),
    emptyOutput: document.getElementById('empty-output'),
    detailMeta: document.getElementById('detail-meta'),
    hiddenFileInput: document.getElementById('hidden-file-input'),
    settingsDialog: document.getElementById('settings-dialog'),
    settingsForm: document.getElementById('settings-form'),
    settingsSaveButton: document.getElementById('settings-save-button'),
    settingsCancelButton: document.getElementById('settings-cancel-button'),
    zoomRange: document.getElementById('zoom-range'),
    offsetXRange: document.getElementById('offset-x-range'),
    offsetYRange: document.getElementById('offset-y-range'),
    alphaThresholdRange: document.getElementById('alpha-threshold-range'),
    resetAdjustmentsButton: document.getElementById('reset-adjustments-button'),
    reprocessButton: document.getElementById('reprocess-button')
};

function createId() {
    return `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function bytesToKB(bytes) {
    return `${Math.round(bytes / 1024)}KB`;
}

function getSelectedItem() {
    return state.items.find((item) => item.id === state.selectedId) || null;
}

function setSelectedItem(id) {
    state.selectedId = id;
    syncAdjustmentControls();
    renderList();
    renderPreview();
}

function patchItem(id, patch) {
    const index = state.items.findIndex((item) => item.id === id);
    if (index === -1) return;
    state.items[index] = { ...state.items[index], ...patch };
}

function getStatusLabel(status) {
    if (status === 'processing') return '処理中';
    if (status === 'done') return '処理完了';
    if (status === 'review') return '要確認';
    if (status === 'exception') return '例外';
    return '未処理';
}

function updateSummary() {
    const total = state.items.length;
    const doneCount = state.items.filter((item) => ['done', 'review', 'exception'].includes(item.status)).length;
    const reviewCount = state.items.filter((item) => item.status === 'review').length;
    const exceptionCount = state.items.filter((item) => item.status === 'exception').length;
    const percent = total === 0 ? 0 : Math.round((doneCount / total) * 100);

    elements.progressBar.value = percent;
    elements.progressLabel.textContent = `${doneCount} / ${total}`;
    elements.statusSummary.textContent = `${total}件 / 要確認 ${reviewCount} / 例外 ${exceptionCount}`;
}

function renderList() {
    elements.imageList.innerHTML = '';
    for (const item of state.items) {
        const row = document.createElement('div');
        row.className = `image-item ${item.status || 'pending'}${item.id === state.selectedId ? ' active' : ''}`;
        row.addEventListener('click', () => setSelectedItem(item.id));

        const removeButton = document.createElement('button');
        removeButton.className = 'image-remove-button';
        removeButton.type = 'button';
        removeButton.textContent = '×';
        removeButton.title = '削除';
        removeButton.addEventListener('click', (event) => {
            event.stopPropagation();
            removeItem(item.id);
        });

        const thumb = document.createElement('img');
        thumb.className = 'item-thumb';
        thumb.src = item.previewPath || item.filePath;

        const meta = document.createElement('div');

        const name = document.createElement('div');
        name.className = 'item-name';
        name.textContent = item.name;

        const sub = document.createElement('div');
        sub.className = 'item-sub';
        const sizeText = item.previewSize ? `${item.outputFormat?.toUpperCase() || ''} ${bytesToKB(item.previewSize)}` : item.originalLabel;
        sub.textContent = `${getStatusLabel(item.status)} / ${sizeText}`;

        meta.appendChild(name);
        meta.appendChild(sub);

        if (item.reason) {
            const reason = document.createElement('div');
            reason.className = 'item-reason';
            reason.textContent = item.reason;
            meta.appendChild(reason);
        }

        row.appendChild(removeButton);
        row.appendChild(thumb);
        row.appendChild(meta);
        elements.imageList.appendChild(row);
    }
    updateSummary();
}

// 画像リストから項目を削除する関数
function removeItem(id) {
    const index = state.items.findIndex((item) => item.id === id);
    if (index === -1) return;

    const wasSelected = state.selectedId === id;
    state.items.splice(index, 1);

    if (state.items.length === 0) {
        state.selectedId = null;
        syncAdjustmentControls();
        renderList();
        renderPreview();
        return;
    }

    if (wasSelected) {
        const nextItem = state.items[Math.min(index, state.items.length - 1)];
        state.selectedId = nextItem?.id || null;
    }

    renderList();
    renderPreview();
}

function renderOverlay(item) {
    elements.sourceOverlay.innerHTML = '';
    if (!item) return;

    const image = elements.sourcePreviewImage;
    if (!image.naturalWidth || !image.naturalHeight) return;

    const displayWidth = image.clientWidth;
    const displayHeight = image.clientHeight;
    const naturalWidth = image.naturalWidth;
    const naturalHeight = image.naturalHeight;
    const scale = Math.min(displayWidth / naturalWidth, displayHeight / naturalHeight);
    const drawnWidth = naturalWidth * scale;
    const drawnHeight = naturalHeight * scale;
    const offsetX = (elements.sourceOverlay.clientWidth - drawnWidth) / 2;
    const offsetY = (elements.sourceOverlay.clientHeight - drawnHeight) / 2;

    const boxes = [];
    if (Array.isArray(item.detection?.faces)) {
        for (const face of item.detection.faces) {
            boxes.push({ ...face, className: 'overlay-box' });
        }
    }

    const previewCropRect = makePreviewCropRect(item);
    if (previewCropRect) {
        boxes.push({ ...previewCropRect, className: 'overlay-box crop-box' });
    }

    for (const box of boxes) {
        const leftValue = box.x ?? box.left ?? 0;
        const topValue = box.y ?? box.top ?? 0;
        const el = document.createElement('div');
        el.className = box.className;
        el.style.left = `${offsetX + leftValue * scale}px`;
        el.style.top = `${offsetY + topValue * scale}px`;
        el.style.width = `${(box.width || 0) * scale}px`;
        el.style.height = `${(box.height || 0) * scale}px`;
        elements.sourceOverlay.appendChild(el);
    }
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

// 加工後プレビュー用の切り抜き範囲を計算する関数
function makePreviewCropRect(item) {
    if (!item || !state.settings) return item?.cropRect || null;
    if (!item.sourceWidth || !item.sourceHeight) return item?.cropRect || null;

    const sourceWidth = Number(item.sourceWidth);
    const sourceHeight = Number(item.sourceHeight);
    const outputWidth = Number(state.settings.outputWidth || 1);
    const outputHeight = Number(state.settings.outputHeight || 1);
    const detection = item.detection || null;
    const manualAdjustments = item.manualAdjustments || {};
    const targetRatio = outputWidth / outputHeight;

    let cropWidth = sourceWidth;
    let cropHeight = Math.round(cropWidth / targetRatio);

    if (cropHeight > sourceHeight) {
        cropHeight = sourceHeight;
        cropWidth = Math.round(cropHeight * targetRatio);
    }

    let centerX = sourceWidth / 2;
    let centerY = sourceHeight / 2;
    let hasFace = false;
    const isSourceSmallerThanOutput = sourceWidth < outputWidth || sourceHeight < outputHeight;

    if (detection && detection.primaryFace && !isSourceSmallerThanOutput) {
        hasFace = true;
        const face = detection.primaryFace;
        centerX = face.x + face.width / 2;
        centerY = face.y + face.height / 2;

        const desiredFaceHeight = outputHeight * (manualAdjustments.faceHeightRatio ?? detection.faceHeightRatio ?? 0.45);
        const zoomFactor = face.height > 0 ? desiredFaceHeight / face.height : 1;
        const normalizedZoom = clamp(zoomFactor, 0.4, 3.0);

        cropHeight = clamp(Math.round(sourceHeight / normalizedZoom), 1, sourceHeight);
        cropWidth = clamp(Math.round(cropHeight * targetRatio), 1, sourceWidth);

        if (cropWidth > sourceWidth) {
            cropWidth = sourceWidth;
            cropHeight = clamp(Math.round(cropWidth / targetRatio), 1, sourceHeight);
        }

        if (cropHeight > sourceHeight) {
            cropHeight = sourceHeight;
            cropWidth = clamp(Math.round(cropHeight * targetRatio), 1, sourceWidth);
        }

        centerY += cropHeight * 0.06;
    }

    const zoom = clamp(Number(manualAdjustments.zoom ?? 1), 0.2, 4.0);
    cropWidth = clamp(Math.round(cropWidth / zoom), 1, sourceWidth);
    cropHeight = clamp(Math.round(cropHeight / zoom), 1, sourceHeight);

    centerX += Number(manualAdjustments.offsetX ?? 0);
    centerY += Number(manualAdjustments.offsetY ?? 0);

    let left = Math.round(centerX - cropWidth / 2);
    let top = Math.round(centerY - cropHeight / 2);

    left = clamp(left, 0, Math.max(0, sourceWidth - cropWidth));
    top = clamp(top, 0, Math.max(0, sourceHeight - cropHeight));

    return { left, top, width: cropWidth, height: cropHeight, hasFace };
}

function ensureOutputPreviewFrame() {
    if (elements.outputPreviewFrame && elements.outputPreviewFrame.isConnected) {
        return elements.outputPreviewFrame;
    }

    const frame = document.createElement('div');
    frame.id = 'output-preview-frame';
    elements.outputPreviewSurface.appendChild(frame);
    frame.appendChild(elements.outputPreviewImage);

    elements.outputPreviewFrame = frame;
    return frame;
}

function getOutputPreviewFrameRect() {
    const surface = elements.outputPreviewSurface;
    if (!surface || !state.settings) return null;

    const surfaceWidth = surface.clientWidth;
    const surfaceHeight = surface.clientHeight;
    if (!surfaceWidth || !surfaceHeight) return null;

    const outputWidth = Number(state.settings.outputWidth || 1);
    const outputHeight = Number(state.settings.outputHeight || 1);
    const targetRatio = outputWidth / outputHeight;

    let frameWidth = surfaceWidth;
    let frameHeight = frameWidth / targetRatio;

    if (frameHeight > surfaceHeight) {
        frameHeight = surfaceHeight;
        frameWidth = frameHeight * targetRatio;
    }

    return {
        width: frameWidth,
        height: frameHeight,
        left: (surfaceWidth - frameWidth) / 2,
        top: (surfaceHeight - frameHeight) / 2
    };
}

// 加工後プレビュー用の描画パラメータを計算する関数
function getOutputPreviewTransform(item) {
    const image = elements.outputPreviewImage;
    const frame = ensureOutputPreviewFrame();
    const frameRect = getOutputPreviewFrameRect();
    if (!item || !image || !frame || !frameRect) return null;
    if (!image.naturalWidth || !image.naturalHeight) return null;

    const previewCropRect = makePreviewCropRect(item);
    if (!previewCropRect) return null;

    const cropWidth = Math.max(1, Number(previewCropRect.width || 1));
    const cropHeight = Math.max(1, Number(previewCropRect.height || 1));
    const scale = Math.max(frameRect.width / cropWidth, frameRect.height / cropHeight);

    const width = image.naturalWidth * scale;
    const height = image.naturalHeight * scale;
    const left = -Number(previewCropRect.left || 0) * scale;
    const top = -Number(previewCropRect.top || 0) * scale;

    return {
        frameWidth: frameRect.width,
        frameHeight: frameRect.height,
        frameLeft: frameRect.left,
        frameTop: frameRect.top,
        width,
        height,
        left,
        top
    };
}

// 加工後プレビューを反映する関数
function applyOutputPreviewTransform(item) {
    const transform = getOutputPreviewTransform(item);
    if (!transform) return;

    const frame = ensureOutputPreviewFrame();

    frame.style.width = `${transform.frameWidth}px`;
    frame.style.height = `${transform.frameHeight}px`;
    frame.style.left = `${transform.frameLeft}px`;
    frame.style.top = `${transform.frameTop}px`;

    elements.outputPreviewImage.style.width = `${transform.width}px`;
    elements.outputPreviewImage.style.height = `${transform.height}px`;
    elements.outputPreviewImage.style.left = `${transform.left}px`;
    elements.outputPreviewImage.style.top = `${transform.top}px`;
    elements.outputPreviewImage.style.maxWidth = 'none';
    elements.outputPreviewImage.style.maxHeight = 'none';
    elements.outputPreviewImage.style.objectFit = 'fill';
    elements.outputPreviewImage.style.transform = 'none';
}

function renderPreview() {
    const item = getSelectedItem();
    const frame = ensureOutputPreviewFrame();

    if (!item) {
        elements.sourcePreviewImage.classList.remove('visible');
        elements.outputPreviewImage.classList.remove('visible');
        elements.emptySource.style.display = 'block';
        elements.emptyOutput.style.display = 'block';
        elements.sourceOverlay.innerHTML = '';
        elements.detailMeta.textContent = '';
        frame.style.display = 'none';
        frame.classList.remove('transparent-preview');
        elements.outputPreviewImage.style.transform = '';
        elements.outputPreviewImage.style.width = '';
        elements.outputPreviewImage.style.height = '';
        elements.outputPreviewImage.style.left = '';
        elements.outputPreviewImage.style.top = '';
        return;
    }

    elements.sourcePreviewImage.src = item.filePath;
    elements.sourcePreviewImage.classList.add('visible');
    elements.emptySource.style.display = 'none';
    elements.sourcePreviewImage.onload = () => renderOverlay(item);

    const outputPreviewPath = item.outputPreviewPath || item.previewPath || item.filePath;
    const isTransparentPreview = item.settingsUsed?.outputMode === 'transparent-person-png';

    if (outputPreviewPath) {
        const outputPreviewUrl = `${outputPreviewPath}${outputPreviewPath.includes('?') ? '&' : '?'}v=${Date.now()}`;

        frame.style.display = 'block';
        frame.classList.toggle('transparent-preview', isTransparentPreview);
        elements.outputPreviewImage.src = outputPreviewUrl;
        elements.outputPreviewImage.classList.add('visible');
        elements.emptyOutput.style.display = 'none';
        elements.outputPreviewImage.onload = () => applyOutputPreviewTransform(getSelectedItem());
        if (elements.outputPreviewImage.complete) {
            applyOutputPreviewTransform(item);
        }
    } else {
        frame.style.display = 'none';
        frame.classList.remove('transparent-preview');
        elements.outputPreviewImage.classList.remove('visible');
        elements.emptyOutput.style.display = 'block';
        elements.outputPreviewImage.style.transform = '';
        elements.outputPreviewImage.style.width = '';
        elements.outputPreviewImage.style.height = '';
        elements.outputPreviewImage.style.left = '';
        elements.outputPreviewImage.style.top = '';
    }

    const messages = [];
    if (item.sourceWidth && item.sourceHeight) {
        messages.push(`元画像 ${item.sourceWidth}x${item.sourceHeight}`);
    }
    if (item.settingsUsed) {
        messages.push(`出力 ${item.settingsUsed.outputWidth}x${item.settingsUsed.outputHeight}`);
        messages.push(`形式 ${item.settingsUsed.outputFormat.toUpperCase()}`);
        messages.push(`容量 ${item.settingsUsed.maxFileSizeKB}KB以下`);
    }
    if (item.previewSize) {
        messages.push(`結果 ${bytesToKB(item.previewSize)}`);
    }
    if (item.detection) {
        messages.push(`顔 ${item.detection.faceCount}件`);
        messages.push(`検出 ${item.detection.detector || 'unknown'}`);
    }
    if (state.human.error) {
        messages.push(`検出器エラー ${state.human.error}`);
    }
    elements.detailMeta.textContent = messages.join(' / ');
}

function fillSettingsForm(settings) {
    const formData = {
        outputWidth: settings.outputWidth,
        outputHeight: settings.outputHeight,
        outputFormat: settings.outputFormat,
        outputMode: settings.outputMode,
        maxFileSizeKB: settings.maxFileSizeKB,
        faceHeightRatio: settings.faceHeightRatio,
        noFacePolicy: settings.noFacePolicy,
        multiFacePolicy: settings.multiFacePolicy,
        outputFolderName: settings.outputFolderName
    };
    for (const [key, value] of Object.entries(formData)) {
        const field = elements.settingsForm.elements.namedItem(key);
        if (field) field.value = value;
    }
}
async function openSettingsDialog(force = false) {
    fillSettingsForm(state.settings);
    if (force) {
        elements.settingsCancelButton.disabled = true;
    } else {
        elements.settingsCancelButton.disabled = false;
    }
    elements.settingsDialog.showModal();
}

async function initializeSettings() {
    state.settings = await window.photoPon.getSettings();
    if (!state.settings.initialized) {
        await openSettingsDialog(true);
    }
}

function gatherSettingsForm() {
    const outputMode = elements.settingsForm.elements.namedItem('outputMode').value;
    const outputFormat = elements.settingsForm.elements.namedItem('outputFormat').value;

    return {
        outputWidth: Number(elements.settingsForm.elements.namedItem('outputWidth').value),
        outputHeight: Number(elements.settingsForm.elements.namedItem('outputHeight').value),
        outputFormat,
        outputMode,
        maxFileSizeKB: Number(elements.settingsForm.elements.namedItem('maxFileSizeKB').value),
        faceHeightRatio: Number(elements.settingsForm.elements.namedItem('faceHeightRatio').value),
        noFacePolicy: elements.settingsForm.elements.namedItem('noFacePolicy').value,
        multiFacePolicy: elements.settingsForm.elements.namedItem('multiFacePolicy').value,
        outputFolderName: elements.settingsForm.elements.namedItem('outputFolderName').value.trim() || 'photo-pon-export'
    };
}
async function saveSettingsFromDialog() {
    const nextSettings = gatherSettingsForm();
    state.settings = await window.photoPon.saveSettings(nextSettings);
    elements.settingsDialog.close();
}

function createScaledCanvas(image, maxDimension = 1280) {
    const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(image, 0, 0, width, height);
    return { canvas, scale };
}

async function ensureHumanDetector() {
    if (state.human.ready && state.human.instance) {
        return state.human.instance;
    }
    if (state.human.loading) {
        while (state.human.loading) {
            await new Promise((resolve) => setTimeout(resolve, 50));
        }
        return state.human.instance;
    }

    state.human.loading = true;
    state.human.error = '';

    try {
        const HumanNamespace = window.Human;
        const HumanClass = HumanNamespace?.Human || HumanNamespace?.default?.Human;
        if (!HumanClass) {
            throw new Error('Human library not loaded');
        }

        const modelBase = '../node_modules/@vladmandic/human/models';
        const config = {
            backend: 'webgl',
            async: true,
            filter: { enabled: false },
            body: { enabled: false },
            hand: { enabled: false },
            object: { enabled: false },
            gesture: { enabled: false },
            face: {
                enabled: true,
                modelPath: `${modelBase}/blazeface.json`,
                detector: {
                    enabled: true,
                    rotation: false,
                    square: false,
                    maxDetected: 5,
                    minConfidence: 0.25,
                    minSize: 64,
                    modelPath: `${modelBase}/blazeface.json`
                },
                mesh: { enabled: false },
                iris: { enabled: false },
                attention: { enabled: false },
                emotion: { enabled: false },
                description: { enabled: false },
                antispoof: { enabled: false },
                liveness: { enabled: false }
            }
        };

        const instance = new HumanClass(config);
        if (typeof instance.load === 'function') {
            await instance.load();
        }
        if (typeof instance.warmup === 'function') {
            await instance.warmup();
        }
        state.human.instance = instance;
        state.human.available = true;
        state.human.ready = true;
        state.human.detector = '@vladmandic/human';
        return instance;
    } catch (error) {
        console.error('[photo-pon] Human initialization failed:', error);
        state.human.instance = null;
        state.human.available = false;
        state.human.ready = false;
        state.human.detector = 'fallback-center-face';
        state.human.error = error?.message || String(error);
        return null;
    } finally {
        state.human.loading = false;
    }
}

function makeFallbackDetection(image) {
    const width = image.naturalWidth;
    const height = image.naturalHeight;
    const faceWidth = Math.round(width * 0.36);
    const faceHeight = Math.round(height * 0.36);
    const x = Math.round((width - faceWidth) / 2);
    const y = Math.round(height * 0.18);

    return {
        faceCount: 1,
        faces: [{ x, y, width: faceWidth, height: faceHeight, score: 0.01 }],
        primaryFace: { x, y, width: faceWidth, height: faceHeight, score: 0.01 },
        faceHeightRatio: state.settings.faceHeightRatio,
        detector: 'fallback-center-face',
        usedFallback: true
    };
}

function normalizeHumanFaces(faceResults, inverseScale) {
    return faceResults
        .map((face) => {
            const sourceBox = face?.box || face?.boxRaw;
            if (!sourceBox) return null;
            const x = Math.round((sourceBox.x ?? sourceBox[0] ?? 0) * inverseScale);
            const y = Math.round((sourceBox.y ?? sourceBox[1] ?? 0) * inverseScale);
            const width = Math.round((sourceBox.width ?? sourceBox[2] ?? 0) * inverseScale);
            const height = Math.round((sourceBox.height ?? sourceBox[3] ?? 0) * inverseScale);
            const score = face?.score ?? face?.faceScore ?? face?.boxScore ?? 0;
            return { x, y, width, height, score };
        })
        .filter((face) => face && face.width > 0 && face.height > 0)
        .sort((a, b) => (b.width * b.height) - (a.width * a.height));
}

async function detectFacesFromImage(filePath) {
    return new Promise((resolve) => {
        const image = new Image();
        image.onload = async () => {
            try {
                const detector = await ensureHumanDetector();
                if (!detector) {
                    resolve(makeFallbackDetection(image));
                    return;
                }

                const { canvas, scale } = createScaledCanvas(image, 1280);
                const result = await detector.detect(canvas);
                const faces = normalizeHumanFaces(result?.face || [], 1 / scale);

                resolve({
                    faceCount: faces.length,
                    faces,
                    primaryFace: faces[0] || null,
                    faceHeightRatio: state.settings.faceHeightRatio,
                    detector: '@vladmandic/human',
                    usedFallback: false
                });
            } catch (error) {
                console.error('[photo-pon] Face detection failed:', error);
                state.human.error = error?.message || String(error);
                resolve(makeFallbackDetection(image));
            }
        };
        image.onerror = () => {
            resolve({
                faceCount: 0,
                faces: [],
                primaryFace: null,
                faceHeightRatio: state.settings.faceHeightRatio,
                detector: state.human.available ? '@vladmandic/human' : 'fallback-center-face',
                usedFallback: !state.human.available
            });
        };
        image.src = filePath;
    });
}

async function processItem(item) {
    patchItem(item.id, { status: 'processing', reason: '' });
    renderList();

    const detection = await detectFacesFromImage(item.filePath);
    patchItem(item.id, { detection });

    const result = await window.photoPon.processImage({
        id: item.id,
        filePath: item.filePath,
        detection,
        manualAdjustments: item.manualAdjustments || null
    });

    patchItem(item.id, { ...result });
    renderList();
    if (state.selectedId === item.id) {
        renderPreview();
    }
}

async function processNewFiles(filePaths) {
    const normalizedPaths = [...new Set(filePaths.filter(Boolean))];
    if (normalizedPaths.length === 0) return;

    const itemsToProcess = [];

    for (const filePath of normalizedPaths) {
        const existingItem = state.items.find((item) => item.filePath === filePath);

        if (existingItem) {
            patchItem(existingItem.id, {
                status: 'pending',
                reason: '',
                originalLabel: '再追加後再処理'
            });
            itemsToProcess.push(existingItem);
            continue;
        }

        const newItem = {
            id: createId(),
            filePath,
            name: filePath.split(/[\\/]/).pop(),
            status: 'pending',
            reason: '',
            manualAdjustments: { zoom: 1, offsetX: 0, offsetY: 0, alphaThreshold: 24 },
            originalLabel: '追加直後'
        };

        state.items.push(newItem);
        itemsToProcess.push(newItem);
    }

    renderList();

    if (itemsToProcess[0]) {
        setSelectedItem(itemsToProcess[0].id);
    }

    for (const item of itemsToProcess) {
        await processItem(item);
    }
}

function syncAdjustmentControls() {
    const item = getSelectedItem();
    const adjustments = item?.manualAdjustments || { zoom: 1, offsetX: 0, offsetY: 0, alphaThreshold: 24 };
    elements.zoomRange.value = String(adjustments.zoom ?? 1);
    elements.offsetXRange.value = String(adjustments.offsetX ?? 0);
    elements.offsetYRange.value = String(adjustments.offsetY ?? 0);
    elements.alphaThresholdRange.value = String(adjustments.alphaThreshold ?? 24);

    const isTransparentMode = item?.settingsUsed?.outputMode === 'transparent-person-png' || state.settings?.outputMode === 'transparent-person-png';
    elements.alphaThresholdRange.disabled = !isTransparentMode;
}

function scheduleReprocessSelected(delay = 180) {
    if (state.ui.reprocessTimer) {
        clearTimeout(state.ui.reprocessTimer);
    }

    state.ui.reprocessTimer = setTimeout(async () => {
        state.ui.reprocessTimer = null;
        const item = getSelectedItem();
        if (!item) return;
        await processItem(item);
    }, delay);
}

function updateAdjustmentValue(key, value, options = {}) {
    const item = getSelectedItem();
    if (!item) return;

    const numericValue = key === 'zoom'
        ? clamp(Number(value), 0.2, 4.0)
        : key === 'alphaThreshold'
            ? clamp(Math.round(Number(value)), 0, 255)
            : Number(value);

    const manualAdjustments = { ...(item.manualAdjustments || {}), [key]: numericValue };
    patchItem(item.id, { manualAdjustments });
    syncAdjustmentControls();
    renderPreview();

    if (options.skipReprocess) return;
    scheduleReprocessSelected();
}

async function reprocessSelected() {
    const item = getSelectedItem();
    if (!item) return;
    await processItem(item);
    renderPreview();
}

async function exportAll() {
    const result = await window.photoPon.exportItems(state.items);
    if (!result.ok) {
        if (result.canceled) {
            return;
        }
        window.alert(result.message);
        return;
    }
    window.alert(`${result.count}件を書き出しました。\n${result.targetDir}`);
}

function installDropHandlers() {
    const preventDefaults = (event) => {
        event.preventDefault();
        event.stopPropagation();
    };

    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach((eventName) => {
        elements.dropZone.addEventListener(eventName, preventDefaults);
    });

    ['dragenter', 'dragover'].forEach((eventName) => {
        elements.dropZone.addEventListener(eventName, () => elements.dropZone.classList.add('dragover'));
    });

    ['dragleave', 'drop'].forEach((eventName) => {
        elements.dropZone.addEventListener(eventName, () => elements.dropZone.classList.remove('dragover'));
    });

    elements.dropZone.addEventListener('drop', async (event) => {
        const filePaths = Array.from(event.dataTransfer.files || [])
            .map((file) => window.photoPon.getPathForFile(file))
            .filter(Boolean);
        await processNewFiles(filePaths);
    });

    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach((eventName) => {
        window.addEventListener(eventName, preventDefaults);
    });
}

function installEvents() {
    elements.zoomRange.min = '0.2';
    elements.zoomRange.max = '4.0';
    elements.zoomRange.step = '0.05';

    elements.addFilesButton.addEventListener('click', () => elements.hiddenFileInput.click());
    elements.hiddenFileInput.addEventListener('change', async (event) => {
        const filePaths = Array.from(event.target.files || [])
            .map((file) => window.photoPon.getPathForFile(file))
            .filter(Boolean);
        await processNewFiles(filePaths);
        event.target.value = '';
    });

    elements.runExportButton.addEventListener('click', exportAll);
    elements.reprocessButton.addEventListener('click', reprocessSelected);
    elements.resetAdjustmentsButton.addEventListener('click', async () => {
        const item = getSelectedItem();
        if (!item) return;
        patchItem(item.id, { manualAdjustments: { zoom: 1, offsetX: 0, offsetY: 0, alphaThreshold: 24 } });
        syncAdjustmentControls();
        renderPreview();
        await reprocessSelected();
    });

    elements.zoomRange.addEventListener('input', (event) => updateAdjustmentValue('zoom', event.target.value));
    elements.offsetXRange.addEventListener('input', (event) => updateAdjustmentValue('offsetX', event.target.value));
    elements.offsetYRange.addEventListener('input', (event) => updateAdjustmentValue('offsetY', event.target.value));
    elements.alphaThresholdRange.addEventListener('input', (event) => updateAdjustmentValue('alphaThreshold', event.target.value));

    elements.outputPreviewSurface.addEventListener('wheel', (event) => {
        if (!event.ctrlKey) return;

        const item = getSelectedItem();
        if (!item) return;

        event.preventDefault();

        const currentZoom = Number(item.manualAdjustments?.zoom ?? 1);
        const nextZoom = clamp(currentZoom + (event.deltaY < 0 ? 0.05 : -0.05), 0.2, 4.0);
        updateAdjustmentValue('zoom', nextZoom);
    }, { passive: false });

    elements.outputPreviewSurface.addEventListener('mousedown', (event) => {
        const item = getSelectedItem();
        if (!item) return;
        if (event.button !== 0) return;

        state.ui.isDraggingOutput = true;
        state.ui.dragStartClientX = event.clientX;
        state.ui.dragStartClientY = event.clientY;
        state.ui.dragStartOffsetX = Number(item.manualAdjustments?.offsetX ?? 0);
        state.ui.dragStartOffsetY = Number(item.manualAdjustments?.offsetY ?? 0);
        elements.outputPreviewSurface.classList.add('dragging');
        event.preventDefault();
    });

    window.addEventListener('mousemove', (event) => {
        if (!state.ui.isDraggingOutput) return;

        const item = getSelectedItem();
        if (!item) return;

        const deltaX = event.clientX - state.ui.dragStartClientX;
        const deltaY = event.clientY - state.ui.dragStartClientY;

        const nextOffsetX = state.ui.dragStartOffsetX - deltaX;
        const nextOffsetY = state.ui.dragStartOffsetY - deltaY;

        updateAdjustmentValue('offsetX', nextOffsetX, { skipReprocess: true });
        updateAdjustmentValue('offsetY', nextOffsetY, { skipReprocess: true });
    });

    window.addEventListener('mouseup', () => {
        if (!state.ui.isDraggingOutput) return;

        state.ui.isDraggingOutput = false;
        elements.outputPreviewSurface.classList.remove('dragging');
        scheduleReprocessSelected();
    });

    window.addEventListener('resize', () => {
        renderPreview();
    });

    elements.settingsForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        await saveSettingsFromDialog();
    });

    elements.settingsCancelButton.addEventListener('click', (event) => {
        if (!state.settings?.initialized) {
            event.preventDefault();
            return;
        }
        elements.settingsDialog.close();
    });

    window.photoPon.onOpenSettings(async () => {
        await openSettingsDialog(false);
    });

    window.photoPon.onAddImages(async (filePaths) => {
        await processNewFiles(filePaths);
    });

    window.photoPon.onExport(async () => {
        await exportAll();
    });

    window.photoPon.onSettingsUpdated((settings) => {
        state.settings = settings;
        fillSettingsForm(settings);
        renderPreview();
    });
}

(async function bootstrap() {
    installDropHandlers();
    installEvents();
    await initializeSettings();
    await ensureHumanDetector();
    renderList();
    renderPreview();
})();
