/**
 * HLS Player wrapper using hls.js — keep it simple
 */

class HLSPlayer {
  constructor(videoElement, streamUrl) {
    this.video = videoElement;
    this.url = streamUrl;
    this.hls = null;
    this._destroyed = false;
  }

  async init() {
    if (this._destroyed) return;

    if (window.Hls && window.Hls.isSupported()) {
      this.hls = new window.Hls({
        enableWorker: false,
        lowLatencyMode: false,
        maxBufferLength: 30,
        maxMaxBufferLength: 60,
      });

      this.hls.loadSource(this.url);
      this.hls.attachMedia(this.video);

      this.hls.on(window.Hls.Events.MANIFEST_PARSED, () => {
        this.video.muted = true;
        this.video.play().catch(() => {});
      });

      this.hls.on(window.Hls.Events.ERROR, (event, data) => {
        if (data.fatal) {
          if (data.type === window.Hls.ErrorTypes.MEDIA_ERROR) {
            this.hls.recoverMediaError();
          } else if (data.type === window.Hls.ErrorTypes.NETWORK_ERROR) {
            setTimeout(() => {
              if (!this._destroyed && this.hls) this.hls.startLoad();
            }, 2000);
          }
        }
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
