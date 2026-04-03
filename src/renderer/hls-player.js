/**
 * HLS Player wrapper using hls.js
 */

class HLSPlayer {
  constructor(videoElement, streamUrl) {
    this.video = videoElement;
    this.url = streamUrl;
    this.hls = null;
    this._destroyed = false;
    this._stallCheckInterval = null;
  }

  async init() {
    if (this._destroyed) return;

    if (window.Hls && window.Hls.isSupported()) {
      this.hls = new window.Hls({
        enableWorker: false, // avoid worker contention with many instances
        lowLatencyMode: false,
        maxBufferLength: 10,
        maxMaxBufferLength: 30,
        startFragPrefetch: true
      });

      this.hls.loadSource(this.url);
      this.hls.attachMedia(this.video);

      this.hls.on(window.Hls.Events.MANIFEST_PARSED, () => {
        this._tryPlay();
      });

      this.hls.on(window.Hls.Events.ERROR, (event, data) => {
        if (data.fatal) {
          console.warn(`HLS fatal error for ${this.url}:`, data.type, data.details);
          if (data.type === window.Hls.ErrorTypes.MEDIA_ERROR) {
            this.hls.recoverMediaError();
          } else if (data.type === window.Hls.ErrorTypes.NETWORK_ERROR) {
            // Retry after brief delay
            setTimeout(() => {
              if (!this._destroyed && this.hls) {
                this.hls.startLoad();
              }
            }, 2000);
          }
        }
      });

      // Watch for stalls — if video is paused/stuck after 3s, nudge it
      this._stallCheckInterval = setInterval(() => {
        if (this._destroyed) return;
        if (this.video && this.video.paused && this.video.readyState >= 2) {
          console.log(`Nudging stalled video: ${this.url}`);
          this._tryPlay();
        }
      }, 3000);

    } else if (this.video.canPlayType('application/vnd.apple.mpegurl')) {
      this.video.src = this.url;
      this._tryPlay();
    }
  }

  _tryPlay() {
    if (!this.video || this._destroyed) return;
    this.video.muted = true;
    const p = this.video.play();
    if (p && p.catch) {
      p.catch(err => {
        console.warn(`Play failed for ${this.url}:`, err.message);
      });
    }
  }

  getQuality() {
    if (this.video && typeof this.video.getVideoPlaybackQuality === 'function') {
      return this.video.getVideoPlaybackQuality();
    }
    return null;
  }

  destroy() {
    this._destroyed = true;
    if (this._stallCheckInterval) {
      clearInterval(this._stallCheckInterval);
      this._stallCheckInterval = null;
    }
    if (this.hls) {
      this.hls.destroy();
      this.hls = null;
    }
    if (this.video) {
      this.video.pause();
      this.video.removeAttribute('src');
      this.video.load();
    }
  }
}
