/**
 * Performance metrics collector and display
 * - Status bar: always-on summary at the bottom
 * - Overlay: detailed per-process / per-video breakdown (toggle)
 */

class MetricsCollector {
  constructor() {
    this.overlay = document.getElementById('metrics-content');
    this.intervalId = null;
    this.videoPlayers = [];
    this.gpuName = null;
    this.showOverlay = false;

    // Status bar elements
    this.sbCpu = document.getElementById('sb-cpu');
    this.sbMem = document.getElementById('sb-mem');
    this.sbGpu = document.getElementById('sb-gpu');
    this.sbFps = document.getElementById('sb-fps');
    this.sbWindows = document.getElementById('sb-windows');

    // Fetch GPU info once
    this._fetchGpuInfo();
  }

  async _fetchGpuInfo() {
    try {
      const info = await window.electronAPI.getGpuInfo();
      if (info && info.gpuDevice && info.gpuDevice.length > 0) {
        this.gpuName = info.gpuDevice[0].deviceString || 'Unknown GPU';
      }
    } catch {
      this.gpuName = 'N/A';
    }
  }

  registerPlayer(streamId, player) {
    this.videoPlayers.push({ streamId, player });
  }

  unregisterPlayer(streamId) {
    this.videoPlayers = this.videoPlayers.filter(p => p.streamId !== streamId);
  }

  start() {
    if (this.intervalId) return;
    this.intervalId = setInterval(() => this.collect(), 2000);
    this.collect();
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  setOverlayVisible(visible) {
    this.showOverlay = visible;
  }

  async collect() {
    const metrics = await window.electronAPI.getMetrics();

    // Video quality stats
    const videoStats = this.videoPlayers.map(({ streamId, player }) => {
      const q = player.getQuality();
      if (!q) return { streamId, dropped: 0, total: 0, dropRate: '0.0' };
      const total = q.totalVideoFrames || 0;
      const dropped = q.droppedVideoFrames || 0;
      return {
        streamId,
        dropped,
        total,
        dropRate: total > 0 ? ((dropped / total) * 100).toFixed(1) : '0.0'
      };
    });

    const totalDropped = videoStats.reduce((s, v) => s + v.dropped, 0);
    const totalFrames = videoStats.reduce((s, v) => s + v.total, 0);
    const overallDropRate = totalFrames > 0 ? ((totalDropped / totalFrames) * 100).toFixed(1) : '0.0';

    // Update status bar
    const cpuVal = parseFloat(metrics.totalCpuPercent);
    this.sbCpu.textContent = `CPU: ${metrics.totalCpuPercent}%`;
    this.sbCpu.className = cpuVal > 80 ? 'sb-danger' : cpuVal > 50 ? 'sb-warn' : '';

    const memMB = (metrics.totalMemoryKB / 1024).toFixed(0);
    this.sbMem.textContent = `Mem: ${memMB} MB`;
    this.sbMem.className = memMB > 1000 ? 'sb-warn' : '';

    this.sbGpu.textContent = `GPU: ${this.gpuName || '...'}`;

    const dropVal = parseFloat(overallDropRate);
    this.sbFps.textContent = `Dropped: ${totalDropped} (${overallDropRate}%)`;
    this.sbFps.className = dropVal > 5 ? 'sb-danger' : dropVal > 1 ? 'sb-warn' : '';

    this.sbWindows.textContent = `Windows: ${1 + metrics.detachedWindowCount}`;

    // Update detailed overlay if visible
    if (this.showOverlay) {
      this.renderOverlay(metrics, videoStats);
    }
  }

  renderOverlay(metrics, videoStats) {
    let html = `
      <div class="metric-section">PROCESSES (${metrics.processCount})</div>
    `;

    for (const p of metrics.processes) {
      const memMB = (p.memKB / 1024).toFixed(0);
      const cpuClass = p.cpu > 30 ? 'danger' : p.cpu > 15 ? 'warn' : '';
      html += `
        <div class="metric-row">
          <span class="metric-label">${p.type} (${p.pid})</span>
          <span class="metric-value ${cpuClass}">CPU ${p.cpu}% | ${memMB} MB</span>
        </div>
      `;
    }

    html += `<div class="metric-divider"></div>
      <div class="metric-row">
        <span class="metric-label">Total CPU</span>
        <span class="metric-value">${metrics.totalCpuPercent}%</span>
      </div>
      <div class="metric-row">
        <span class="metric-label">Total Memory</span>
        <span class="metric-value">${(metrics.totalMemoryKB / 1024).toFixed(0)} MB</span>
      </div>
      <div class="metric-row">
        <span class="metric-label">GPU</span>
        <span class="metric-value">${this.gpuName || 'N/A'}</span>
      </div>
      <div class="metric-row">
        <span class="metric-label">Detached Windows</span>
        <span class="metric-value">${metrics.detachedWindowCount}</span>
      </div>
      <div class="metric-row">
        <span class="metric-label">Active Videos (main)</span>
        <span class="metric-value">${videoStats.length}</span>
      </div>
    `;

    if (videoStats.length > 0) {
      html += '<div class="metric-divider"></div><div class="metric-section">PER-VIDEO STATS</div>';
      for (const vs of videoStats) {
        const dropClass = vs.dropRate > 5 ? 'danger' : vs.dropRate > 1 ? 'warn' : '';
        html += `
          <div class="metric-row">
            <span class="metric-label">P${vs.streamId}</span>
            <span class="metric-value ${dropClass}">frames: ${vs.total} | dropped: ${vs.dropped} (${vs.dropRate}%)</span>
          </div>
        `;
      }
    }

    this.overlay.innerHTML = html;
  }
}
