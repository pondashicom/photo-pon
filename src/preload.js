const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('photoPon', {
    getSettings: () => ipcRenderer.invoke('settings:get'),
    saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),
    processImage: (job) => ipcRenderer.invoke('images:process-one', job),
    readBuffer: (filePath) => ipcRenderer.invoke('images:read-buffer', filePath),
    exportItems: (items) => ipcRenderer.invoke('export:run', { items }),
    getPathForFile: (file) => webUtils.getPathForFile(file),
    onOpenSettings: (callback) => ipcRenderer.on('menu:open-settings', () => callback()),
    onAddImages: (callback) => ipcRenderer.on('menu:add-images', (_event, filePaths) => callback(filePaths)),
    onExport: (callback) => ipcRenderer.on('menu:export', () => callback()),
    onSettingsUpdated: (callback) => ipcRenderer.on('settings:updated', (_event, settings) => callback(settings))
});
