# Electron Video Room Prototype

Engineering prototype of a desktop video room client built on Electron. Tests the viability of a web/Electron approach for simultaneous multi-stream video rendering with pop-out (detached) windows.

![Demo](demo.gif)

## How the Rendering Pipeline Works

### Architecture Overview

```
┌──────────────────┐   HTTP GET    ┌──────────────────────────────────────┐
│  Local HLS Server│◄─────────────►│  Electron (Chromium)                 │
│  (Node/Express)  │  .m3u8 + .ts  │                                      │
│                  │               │  ┌─ Main Window (renderer process) ─┐│
│  Static files:   │               │  │  <video> + hls.js  ×N tiles      ││
│  media/streams/  │               │  └──────────────────────────────────┘│
│   └─ 0/index.m3u8│               │  ┌─ Detached Window (renderer) ────┐│
│   └─ 1/index.m3u8│               │  │  <video> + hls.js  ×1           ││
│   └─ ...         │               │  └──────────────────────────────────┘│
└──────────────────┘               └──────────────────────────────────────┘
```

### Step-by-step: Network → Pixels

1. **Segment preparation (offline, ffmpeg)**
   Source video files (.avi/.mp4/.mkv) are transcoded into HLS format:
   - H.264 video at 640×480, 800 kbps, `ultrafast` preset
   - AAC audio at 64 kbps
   - 2-second `.ts` segments + `.m3u8` playlist per stream
   - 12 streams are created from the source files (cycling with random offsets for variety)

2. **Network delivery (Express static server)**
   Segments are served over HTTP from `localhost:3001` with correct MIME types (`application/vnd.apple.mpegurl`, `video/mp2t`). This ensures the client goes through a real network receive path — not local file playback.

3. **Demuxing & buffering (hls.js in the renderer process)**
   Each `<video>` tile runs its own `hls.js` instance that:
   - Fetches the `.m3u8` manifest via `XMLHttpRequest`
   - Downloads `.ts` segments progressively
   - Demuxes MPEG-TS into raw H.264 NAL units and AAC frames (in JavaScript, on the main thread — `enableWorker: false` to avoid Web Worker contention with many simultaneous instances)
   - Feeds demuxed data into a `MediaSource` / `SourceBuffer` via MSE (Media Source Extensions)

4. **Decoding (Chromium's media pipeline)**
   Once data is in the `SourceBuffer`, Chromium's native media stack takes over:
   - **H.264 decode** is handled by the platform's hardware decoder (VideoToolbox on macOS, DXVA/NVDEC on Windows) when available, falling back to FFmpeg software decode
   - Decoded frames are uploaded as GPU textures
   - This happens in Chromium's GPU process, **not** in the renderer process

5. **Compositing & display (Chromium compositor)**
   Each `<video>` element is rendered as a compositor layer. Chromium's GPU-accelerated compositor:
   - Treats each video as a separate texture quad
   - Composites all tiles together with the CSS grid layout, overlays, and UI
   - Presents the final frame via the platform's display API (Metal on macOS, D3D11/Vulkan on Windows)

### Where It's Efficient

- **Hardware video decode**: H.264 decoding is offloaded to dedicated silicon (VideoToolbox/NVDEC). The CPU cost per stream is near-zero for the decode step itself.
- **GPU compositing**: Video frames stay on the GPU from decode through compositing to display. No CPU-side pixel copies for rendering.
- **Independent streams**: Each HLS instance is self-contained. Adding or removing a stream doesn't affect others.

### Where It's Inefficient

- **hls.js demuxing on the main thread**: MPEG-TS demuxing and MSE buffer management run in JavaScript. With 8–12 simultaneous instances, this creates meaningful main-thread pressure. Web Workers are disabled (`enableWorker: false`) because multiple concurrent workers caused stalls — but this means demuxing competes with UI/layout work.
- **Per-stream memory overhead**: Each `<video>` element + `MediaSource` + hls.js instance maintains its own buffer pool. At 12 streams × ~10 seconds of buffer, memory usage grows linearly.
- **Chromium multi-process model**: Each `BrowserWindow` (detached video) spawns a separate renderer process. This provides isolation but costs ~30–50 MB of base memory per window, plus a separate GPU texture pipeline.
- **No shared decode context**: Unlike a native app that could feed multiple streams through a single decode session or shared texture pool, each `<video>` element is fully independent in Chromium. There's no way to share decode resources across elements.
- **MSE overhead**: The MediaSource Extensions API adds a JavaScript↔native boundary crossing for every segment. A native app would feed compressed data directly to the decoder without this intermediary.

### Detach/Reattach Mechanics

When a video is detached (popped out):
1. The hls.js instance in the main window is destroyed
2. A new `BrowserWindow` is created (new Chromium renderer process)
3. A fresh hls.js instance connects to the same HLS URL independently
4. The main window tile shows a placeholder

This means detach has a brief buffering pause (~1–2 seconds) while the new hls.js instance downloads its first segments. The HLS stream is stateless HTTP — multiple clients can read the same segments concurrently without coordination.

Reattach reverses the process: the detached window is closed (renderer process exits), and a new hls.js instance starts in the main window tile.

## Requirements

- Node.js 18+
- ffmpeg (`brew install ffmpeg`)

## Quick Start

### 1. Prepare test videos

Place one or more video files (.mp4/.avi/.mkv/.mov) in `media/source/`, then run:

```bash
bash start.sh
```

This will transcode source files into 12 HLS streams (if not already done) and start the server.

### 2. Launch the Electron app

In a separate terminal:

```bash
npm start
```

### Controls

- **+/−** buttons in the header: add/remove video streams (1–12)
- **⬈** on each tile: detach video to a separate window
- **⬋** or close the window: return video to the main grid
- **Metrics** button: toggle detailed per-process performance overlay
- **Status bar** (bottom): always-on CPU, memory, dropped frames summary

## Test Scenarios

| Scenario | Streams | Detached | What to observe |
|----------|---------|----------|-----------------|
| Baseline | 4 | 0 | Base CPU/memory for 4 simultaneous decodes |
| Scale up | 8, then 12 | 0 | Main thread pressure from hls.js demuxing |
| Mixed | 8 | 4 detached | Per-window memory overhead, GPU process load |
| Full detach | 4 | all 4 | Multi-window compositor behavior |
| Stress | 12 | 6 detached | Maximum realistic load |

For GPU usage on macOS, use Activity Monitor (GPU History) or:
```bash
sudo powermetrics --samplers gpu_power -i 2000 -n 5
```

## Project Structure

```
├── server/
│   ├── index.js          # Express server — serves HLS segments + stream list API
│   └── prepare-hls.sh    # ffmpeg script — transcodes source videos to HLS
├── media/
│   ├── source/           # Your video files (not committed)
│   └── streams/          # Generated HLS segments (not committed)
├── src/
│   ├── main.js           # Electron main process — window management, IPC, metrics
│   ├── preload.js        # Context bridge — exposes IPC to renderers
│   └── renderer/
│       ├── index.html    # Main room layout
│       ├── styles.css    # All styles (main + detached windows)
│       ├── app.js        # Room logic — grid, +/−, detach/reattach
│       ├── hls-player.js # hls.js wrapper with stall detection
│       ├── metrics.js    # Performance collector (status bar + overlay)
│       ├── detached.html # Detached video window
│       └── detached.js   # Detached window logic
├── start.sh              # One-shot: prepare HLS + start server
└── package.json
```
