const { app, BrowserWindow, Menu, dialog, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const { pathToFileURL } = require('url');
const { fork } = require('child_process');
const sharp = require('sharp');
const StoreModule = require('electron-store');
const Store = StoreModule.default || StoreModule;
const defaultSettings = require('./default-settings');

const store = new Store({
    name: 'settings',
    defaults: defaultSettings
});

let mainWindow = null;
let isExporting = false;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1440,
        height: 920,
        minWidth: 1100,
        minHeight: 700,
        backgroundColor: '#1b1b1b',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            sandbox: false,
            nodeIntegration: false
        }
    });

    mainWindow.loadFile(path.join(__dirname, 'index.html'));
    buildMenu();
}

function buildMenu() {
    const template = [
        {
            label: 'File',
            submenu: [
                {
                    label: 'Add Images',
                    accelerator: 'Ctrl+O',
                    click: async () => {
                        if (!mainWindow) return;
                        const result = await dialog.showOpenDialog(mainWindow, {
                            properties: ['openFile', 'multiSelections'],
                            filters: [
                                {
                                    name: 'Images',
                                    extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'tif', 'tiff', 'avif']
                                }
                            ]
                        });
                        if (!result.canceled && result.filePaths.length > 0) {
                            mainWindow.webContents.send('menu:add-images', result.filePaths);
                        }
                    }
                },
                {
                    label: 'Export',
                    accelerator: 'Ctrl+E',
                    click: () => {
                        if (mainWindow) {
                            mainWindow.webContents.send('menu:export');
                        }
                    }
                },
                { type: 'separator' },
                { role: 'quit' }
            ]
        },
        {
            label: 'Settings',
            submenu: [
                {
                    label: 'Processing Settings',
                    accelerator: 'Ctrl+,',
                    click: () => {
                        if (mainWindow) {
                            mainWindow.webContents.send('menu:open-settings');
                        }
                    }
                },
                {
                    label: 'Reset Settings',
                    click: () => {
                        store.clear();
                        Object.entries(defaultSettings).forEach(([key, value]) => store.set(key, value));
                        if (mainWindow) {
                            mainWindow.webContents.send('settings:updated', store.store);
                            mainWindow.webContents.send('menu:open-settings');
                        }
                    }
                }
            ]
        },
    ];

    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function getSettings() {
    return {
        ...defaultSettings,
        ...store.store
    };
}

function ensurePreviewRoot() {
    const previewRoot = path.join(app.getPath('userData'), 'preview-cache');
    fs.mkdirSync(previewRoot, { recursive: true });
    return previewRoot;
}

// 背景透過用の一時ファイル置き場を作る関数
function ensureBackgroundRemovalRoot() {
    const backgroundRemovalRoot = path.join(app.getPath('userData'), 'background-removal-cache');
    fs.mkdirSync(backgroundRemovalRoot, { recursive: true });
    return backgroundRemovalRoot;
}

// 背景透過ワーカーを実行する関数
function runBackgroundRemovalWorker({ jobId, inputPath, outputPath }) {
    return new Promise((resolve, reject) => {
        const workerPath = app.isPackaged
            ? path.join(process.resourcesPath, 'app', 'src', 'background-removal-worker.js')
            : path.join(__dirname, 'background-removal-worker.js');

        const child = fork(workerPath, [], {
            env: {
                ...process.env,
                ELECTRON_RUN_AS_NODE: '1'
            },
            stdio: ['ignore', 'pipe', 'pipe', 'ipc']
        });

        let settled = false;

        const finishResolve = (value) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeoutId);
            resolve(value);
        };

        const finishReject = (error) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeoutId);
            reject(error);
        };

        const timeoutId = setTimeout(() => {
            try {
                child.kill();
            } catch (killError) {
                console.error('[background-removal-worker] kill-failed', {
                    jobId,
                    message: killError?.message || String(killError)
                });
            }
            finishReject(new Error('背景透過ワーカーがタイムアウトしました。'));
        }, 120000);

        child.stdout?.on('data', (chunk) => {
            const text = String(chunk).trim();
            if (!text) return;
            console.log('[background-removal-worker]', text);
        });

        child.stderr?.on('data', (chunk) => {
            const text = String(chunk).trim();
            if (!text) return;
            console.error('[background-removal-worker]', text);
        });

        child.on('message', (message) => {
            if (!message || typeof message !== 'object') return;

            if (message.type === 'done') {
                finishResolve(message);
                return;
            }

            if (message.type === 'error') {
                finishReject(new Error(message.message || '背景透過ワーカーでエラーが発生しました。'));
            }
        });

        child.on('error', (error) => {
            finishReject(error);
        });

        child.on('exit', (code, signal) => {
            if (settled) return;

            finishReject(new Error(`背景透過ワーカーが異常終了しました。 code=${code} signal=${signal}`));
        });

        child.send({
            jobId,
            inputPath,
            outputPath
        });
    });
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

async function applyAlphaThresholdToPngBuffer(inputBuffer, threshold) {
    const normalizedThreshold = clamp(Math.round(Number(threshold) || 0), 0, 255);

    if (normalizedThreshold <= 0) {
        return inputBuffer;
    }

    const { data, info } = await sharp(inputBuffer, { animated: false })
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });

    for (let index = 3; index < data.length; index += info.channels) {
        if (data[index] < normalizedThreshold) {
            data[index] = 0;
        }
    }

    return sharp(data, {
        raw: {
            width: info.width,
            height: info.height,
            channels: info.channels
        }
    })
        .png()
        .toBuffer();
}

function makeCropRect({ sourceWidth, sourceHeight, outputWidth, outputHeight, detection, manualAdjustments, statusMessages }) {
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

        const desiredFaceHeight = outputHeight * (manualAdjustments?.faceHeightRatio ?? detection.faceHeightRatio ?? 0.45);
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
    } else if (detection && detection.primaryFace && isSourceSmallerThanOutput) {
        statusMessages.push('元画像が指定サイズより小さいため全体拡大を優先');
    } else {
        statusMessages.push('顔未検出のため中央トリミング');
    }

    if (manualAdjustments) {
        const zoom = Math.max(manualAdjustments.zoom ?? 1, 0.05);
        cropWidth = Math.max(1, Math.round(cropWidth / zoom));
        cropHeight = Math.max(1, Math.round(cropHeight / zoom));
        centerX += manualAdjustments.offsetX ?? 0;
        centerY += manualAdjustments.offsetY ?? 0;
    }

    const left = Math.round(centerX - cropWidth / 2);
    const top = Math.round(centerY - cropHeight / 2);

    if (!hasFace && detection?.faceCount > 1) {
        statusMessages.push('複数人検出');
    }

    return { left, top, width: cropWidth, height: cropHeight };
}

async function extractCropBuffer(sourceBuffer, cropRect) {
    const metadata = await sharp(sourceBuffer, { animated: false }).metadata();
    const sourceWidth = metadata.width || 0;
    const sourceHeight = metadata.height || 0;

    const extendLeft = Math.max(0, -cropRect.left);
    const extendTop = Math.max(0, -cropRect.top);
    const extendRight = Math.max(0, cropRect.left + cropRect.width - sourceWidth);
    const extendBottom = Math.max(0, cropRect.top + cropRect.height - sourceHeight);

    const extractLeft = cropRect.left + extendLeft;
    const extractTop = cropRect.top + extendTop;

    return sharp(sourceBuffer, { animated: false })
        .extend({
            left: extendLeft,
            top: extendTop,
            right: extendRight,
            bottom: extendBottom,
            background: { r: 0, g: 0, b: 0, alpha: 0 }
        })
        .extract({
            left: extractLeft,
            top: extractTop,
            width: cropRect.width,
            height: cropRect.height
        })
        .toBuffer();
}

async function encodeWithinLimit(inputBuffer, settings, formatOverride = null) {
    const format = formatOverride || settings.outputFormat;
    const maxBytes = Math.max(1, Number(settings.maxFileSizeKB || 0)) * 1024;

    if (format === 'png') {
        const buffer = await sharp(inputBuffer).png({ compressionLevel: settings.pngCompressionLevel ?? 9 }).toBuffer();
        return { buffer, finalQuality: null, withinLimit: buffer.length <= maxBytes };
    }

    const qualitySteps = [95, 92, 90, 88, 85, 82, 80, 76, 72, 68, 64, 60, 56, 52, 48, 44, 40, 36, 32, 28];
    let lastBuffer = null;
    let lastQuality = null;

    for (const quality of qualitySteps) {
        let pipeline = sharp(inputBuffer);
        if (format === 'jpeg') {
            pipeline = pipeline.jpeg({ quality, mozjpeg: true });
        } else if (format === 'webp') {
            pipeline = pipeline.webp({ quality });
        } else {
            pipeline = pipeline.toFormat(format);
        }
        const buffer = await pipeline.toBuffer();
        lastBuffer = buffer;
        lastQuality = quality;
        if (buffer.length <= maxBytes) {
            return { buffer, finalQuality: quality, withinLimit: true };
        }
    }

    return { buffer: lastBuffer, finalQuality: lastQuality, withinLimit: false };
}

async function renderExportBufferFromItem(item) {
    const settings = getSettings();
    const outputMode = settings.outputMode || 'normal';
    const isTransparentMode = outputMode === 'transparent-person-png';
    const effectiveOutputFormat = isTransparentMode ? 'png' : settings.outputFormat;

    const orientedSourceBuffer = await sharp(item.filePath, { animated: false })
        .rotate()
        .toBuffer();

    let workingSourceBuffer = orientedSourceBuffer;

    if (isTransparentMode) {
        const backgroundRemovalRoot = ensureBackgroundRemovalRoot();
        const backgroundRemovalInputPath = path.join(backgroundRemovalRoot, `${item.id}-export-input.png`);
        const backgroundRemovalOutputPath = path.join(backgroundRemovalRoot, `${item.id}-export-output.png`);

        await sharp(orientedSourceBuffer, { animated: false })
            .png()
            .toFile(backgroundRemovalInputPath);

        await runBackgroundRemovalWorker({
            jobId: `${item.id}-export`,
            inputPath: backgroundRemovalInputPath,
            outputPath: backgroundRemovalOutputPath
        });

        const removedBuffer = await fsp.readFile(backgroundRemovalOutputPath);
        const alphaThreshold = clamp(Math.round(Number(item.manualAdjustments?.alphaThreshold ?? 24)), 0, 255);
        workingSourceBuffer = await applyAlphaThresholdToPngBuffer(removedBuffer, alphaThreshold);
    }

    const cropRect = makeCropRect({
        sourceWidth: item.sourceWidth,
        sourceHeight: item.sourceHeight,
        outputWidth: Number(settings.outputWidth),
        outputHeight: Number(settings.outputHeight),
        detection: item.detection,
        manualAdjustments: item.manualAdjustments,
        statusMessages: []
    });

    const croppedBuffer = await sharp(await extractCropBuffer(workingSourceBuffer, cropRect), { animated: false })
        .resize(Number(settings.outputWidth), Number(settings.outputHeight), {
            fit: 'cover',
            position: 'centre'
        })
        .png({ compressionLevel: settings.pngCompressionLevel ?? 9 })
        .toBuffer();

    const encoded = await encodeWithinLimit(croppedBuffer, settings, effectiveOutputFormat);

    return {
        buffer: encoded.buffer,
        outputFormat: effectiveOutputFormat
    };
}

async function processImageJob(job) {
    const settings = getSettings();
    const outputMode = settings.outputMode || 'normal';
    const isTransparentMode = outputMode === 'transparent-person-png';
    const effectiveOutputFormat = isTransparentMode ? 'png' : settings.outputFormat;
    const previewRoot = ensurePreviewRoot();
    const previewFilename = `${job.id}.${effectiveOutputFormat}`;
    const previewPath = path.join(previewRoot, previewFilename);
    const transparentPreviewFilename = `${job.id}-transparent-preview.png`;
    const transparentPreviewPath = path.join(previewRoot, transparentPreviewFilename);
    const statusMessages = [];

    const orientedSourceBuffer = await sharp(job.filePath, { animated: false })
        .rotate()
        .toBuffer();

    const metadata = await sharp(orientedSourceBuffer).metadata();
    const sourceWidth = metadata.width;
    const sourceHeight = metadata.height;

    if (!sourceWidth || !sourceHeight) {
        throw new Error('画像サイズの取得に失敗しました。');
    }

    const cropRect = makeCropRect({
        sourceWidth,
        sourceHeight,
        outputWidth: Number(settings.outputWidth),
        outputHeight: Number(settings.outputHeight),
        detection: job.detection,
        manualAdjustments: job.manualAdjustments,
        statusMessages
    });

    let workingSourceBuffer = orientedSourceBuffer;
    let outputPreviewPath = job.filePath;
    let backgroundRemovalFailed = false;

    if (isTransparentMode) {
        let backgroundRemovalInputPath = null;

        try {
            const backgroundRemovalRoot = ensureBackgroundRemovalRoot();
            backgroundRemovalInputPath = path.join(backgroundRemovalRoot, `${job.id}-input.png`);
            const backgroundRemovalOutputPath = path.join(backgroundRemovalRoot, `${job.id}-output.png`);

            console.log('[background-removal] start', {
                jobId: job.id,
                inputPath: backgroundRemovalInputPath
            });

            await sharp(orientedSourceBuffer, { animated: false })
                .png()
                .toFile(backgroundRemovalInputPath);

            const inputStat = await fsp.stat(backgroundRemovalInputPath);

            console.log('[background-removal] input-ready', {
                jobId: job.id,
                inputPath: backgroundRemovalInputPath,
                size: inputStat.size
            });

            const workerResult = await runBackgroundRemovalWorker({
                jobId: job.id,
                inputPath: backgroundRemovalInputPath,
                outputPath: backgroundRemovalOutputPath
            });

            console.log('[background-removal] worker-finished', {
                jobId: job.id,
                outputPath: workerResult.outputPath,
                size: workerResult.size
            });

            const removedBuffer = await fsp.readFile(backgroundRemovalOutputPath);
            const alphaThreshold = clamp(Math.round(Number(job.manualAdjustments?.alphaThreshold ?? 24)), 0, 255);
            const thresholdedBuffer = await applyAlphaThresholdToPngBuffer(removedBuffer, alphaThreshold);
            const removedMetadata = await sharp(thresholdedBuffer, { animated: false }).metadata();

            console.log('[background-removal] output-metadata', {
                jobId: job.id,
                width: removedMetadata.width || null,
                height: removedMetadata.height || null,
                format: removedMetadata.format || null,
                hasAlpha: removedMetadata.hasAlpha || false,
                alphaThreshold
            });

            workingSourceBuffer = thresholdedBuffer;
            outputPreviewPath = transparentPreviewPath;
        } catch (error) {
            backgroundRemovalFailed = true;
            console.error('[background-removal]', {
                jobId: job.id,
                inputPath: backgroundRemovalInputPath,
                message: error?.message || String(error),
                stack: error?.stack || null
            });
            statusMessages.push(`背景透過失敗: ${error.message}`);
            workingSourceBuffer = orientedSourceBuffer;
        }
    }

    let previewSize = null;
    let finalQuality = null;
    let encoded = null;

    if (isTransparentMode) {
        const croppedBuffer = await sharp(await extractCropBuffer(workingSourceBuffer, cropRect), { animated: false })
            .resize(Number(settings.outputWidth), Number(settings.outputHeight), {
                fit: 'cover',
                position: 'centre'
            })
            .png({ compressionLevel: settings.pngCompressionLevel ?? 9 })
            .toBuffer();

        encoded = await encodeWithinLimit(croppedBuffer, settings, effectiveOutputFormat);

        if (!backgroundRemovalFailed) {
            await sharp(workingSourceBuffer, { animated: false })
                .png({ compressionLevel: settings.pngCompressionLevel ?? 9 })
                .toFile(transparentPreviewPath);
        }

        await fsp.writeFile(previewPath, encoded.buffer);
        previewSize = encoded.buffer.length;
        finalQuality = encoded.finalQuality;
        outputPreviewPath = transparentPreviewPath;
    }

    const faceCount = job.detection?.faceCount ?? 0;
    let status = 'done';
    let reason = '';

    if (faceCount === 0) {
        status = settings.noFacePolicy === 'exception' ? 'exception' : 'review';
        reason = '顔未検出';
    } else if (faceCount > 1) {
        status = settings.multiFacePolicy === 'exception' ? 'exception' : 'review';
        reason = '複数人検出';
    }

    if (backgroundRemovalFailed) {
        status = 'exception';
        reason = reason ? `${reason} / 背景透過失敗` : '背景透過失敗';
    }

    if (isTransparentMode && encoded && !encoded.withinLimit) {
        statusMessages.push('透過PNGは容量制限判定をスキップ');
    }

    return {
        id: job.id,
        sourceWidth,
        sourceHeight,
        cropRect,
        previewPath: isTransparentMode ? previewPath : null,
        outputPreviewPath,
        previewSize,
        finalQuality,
        outputFormat: effectiveOutputFormat,
        status,
        reason,
        statusMessages,
        settingsUsed: {
            ...settings,
            outputFormat: effectiveOutputFormat
        }
    };
}

function buildExportFolderName(baseName) {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    return `${baseName}_${yyyy}${mm}${dd}_${hh}${mi}`;
}

ipcMain.handle('settings:get', async () => getSettings());

ipcMain.handle('settings:save', async (_event, nextSettings) => {
    const merged = { ...getSettings(), ...nextSettings, initialized: true };

    for (const [key, value] of Object.entries(merged)) {
        store.set(key, value);
    }
    return getSettings();
});

ipcMain.handle('images:process-one', async (_event, job) => {
    return processImageJob(job);
});

ipcMain.handle('images:read-buffer', async (_event, filePath) => {
    const buffer = await fsp.readFile(filePath);
    return buffer;
});

ipcMain.handle('export:run', async (_event, payload) => {
    if (isExporting) {
        return { ok: false, message: '書き出し処理中です。' };
    }

    isExporting = true;
    try {
        const items = Array.isArray(payload?.items) ? payload.items : [];
        const exportableItems = items.filter((item) => item.filePath);
        if (exportableItems.length === 0) {
            return { ok: false, message: '書き出し対象がありません。' };
        }

        const firstSourceDir = path.dirname(exportableItems[0].filePath);
        const outputFolderName = buildExportFolderName(getSettings().outputFolderName || 'photo-pon-export');

        const dialogResult = await dialog.showOpenDialog(mainWindow, {
            title: '書き出し先フォルダを選択',
            buttonLabel: 'ここに書き出す',
            defaultPath: firstSourceDir,
            properties: ['openDirectory', 'createDirectory']
        });

        if (dialogResult.canceled || !dialogResult.filePaths || dialogResult.filePaths.length === 0) {
            return { ok: false, canceled: true };
        }

        const selectedBaseDir = dialogResult.filePaths[0];
        const targetDir = path.join(selectedBaseDir, outputFolderName);
        const results = [];

        await fsp.mkdir(targetDir, { recursive: true });

        for (const item of exportableItems) {
            const rendered = await renderExportBufferFromItem(item);
            const ext = rendered.outputFormat || getSettings().outputFormat;
            const basename = path.basename(item.filePath, path.extname(item.filePath));
            const filename = `${basename}.${ext}`;
            const destination = path.join(targetDir, filename);

            await fsp.writeFile(destination, rendered.buffer);
            results.push({ source: item.filePath, destination });
        }

        return { ok: true, count: results.length, results, targetDir };
    } finally {
        isExporting = false;
    }
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});
