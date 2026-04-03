const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

// Disable autoplay restrictions — critical for multiple simultaneous videos
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
// Prevent Chromium from throttling/pausing media in background windows
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');

const detachedWindows = new Map(); // streamId -> BrowserWindow

let mainWindow = null;

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'Video Room Prototype',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.on('closed', () => {
    // Close all detached windows when main window closes
    for (const [, win] of detachedWindows) {
      if (!win.isDestroyed()) win.close();
    }
    detachedWindows.clear();
    mainWindow = null;
  });
}

function createDetachedWindow(streamId, streamName, streamUrl, bounds = null) {
  if (detachedWindows.has(streamId)) {
    detachedWindows.get(streamId).focus();
    return;
  }

  const winOpts = {
    width: bounds ? bounds.width : 640,
    height: bounds ? bounds.height : 520,
    minWidth: 320,
    minHeight: 280,
    title: streamName,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  };

  if (bounds) {
    winOpts.x = bounds.x;
    winOpts.y = bounds.y;
  }

  const win = new BrowserWindow(winOpts);

  const params = new URLSearchParams({ streamId, streamName, streamUrl });
  win.loadFile(path.join(__dirname, 'renderer', 'detached.html'), { query: Object.fromEntries(params) });

  detachedWindows.set(streamId, win);

  win.on('closed', () => {
    detachedWindows.delete(streamId);
    // Notify main window to reattach
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('video-reattached', streamId);
    }
  });
}

// IPC Handlers
ipcMain.handle('detach-video', (event, { streamId, streamName, streamUrl, bounds }) => {
  createDetachedWindow(streamId, streamName, streamUrl, bounds || null);
  return true;
});

ipcMain.handle('detach-all', (event, streamList) => {
  const { screen } = require('electron');
  const display = screen.getPrimaryDisplay();
  const { width: screenW, height: screenH } = display.workAreaSize;
  const { x: originX, y: originY } = display.workArea;

  const count = streamList.length;
  const cols = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / cols);
  const gap = 4;
  const winW = Math.floor((screenW - gap * (cols + 1)) / cols);
  const winH = Math.floor((screenH - gap * (rows + 1)) / rows);

  for (let i = 0; i < count; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = originX + gap + col * (winW + gap);
    const y = originY + gap + row * (winH + gap);

    const s = streamList[i];
    createDetachedWindow(s.streamId, s.streamName, s.streamUrl, { x, y, width: winW, height: winH });
  }

  return true;
});

ipcMain.handle('reattach-video', (event, streamId) => {
  const win = detachedWindows.get(streamId);
  if (win && !win.isDestroyed()) {
    win.close();
  }
  return true;
});

ipcMain.handle('get-metrics', () => {
  // Per-process metrics from Chromium
  const appMetrics = app.getAppMetrics();

  // Aggregate CPU and memory across all processes
  let totalCpuPercent = 0;
  let totalMemory = 0;
  const processDetails = appMetrics.map(p => {
    totalCpuPercent += p.cpu.percentCPUUsage;
    totalMemory += p.memory.workingSetSize; // KB
    return {
      type: p.type,
      pid: p.pid,
      cpu: p.cpu.percentCPUUsage.toFixed(1),
      memKB: p.memory.workingSetSize,
      name: p.name || p.type
    };
  });

  return {
    totalCpuPercent: totalCpuPercent.toFixed(1),
    totalMemoryKB: totalMemory,
    processCount: appMetrics.length,
    processes: processDetails,
    detachedWindowCount: detachedWindows.size
  };
});

ipcMain.handle('get-gpu-info', async () => {
  try {
    const gpuInfo = await app.getGPUInfo('basic');
    return gpuInfo;
  } catch {
    return null;
  }
});

app.whenReady().then(createMainWindow);

app.on('window-all-closed', () => {
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow();
  }
});
