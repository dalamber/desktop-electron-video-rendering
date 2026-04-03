const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  detachVideo: (data) => ipcRenderer.invoke('detach-video', data),
  reattachVideo: (streamId) => ipcRenderer.invoke('reattach-video', streamId),
  getMetrics: () => ipcRenderer.invoke('get-metrics'),
  getGpuInfo: () => ipcRenderer.invoke('get-gpu-info'),
  onVideoReattached: (callback) => {
    ipcRenderer.on('video-reattached', (event, streamId) => callback(streamId));
  }
});
