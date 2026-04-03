/**
 * Main room application logic
 */

const SERVER_URL = 'http://localhost:3001';
const DEFAULT_STREAM_COUNT = 4;

const videoGrid = document.getElementById('video-grid');
const metricsOverlay = document.getElementById('metrics-overlay');
const btnMetrics = document.getElementById('btn-metrics');
const btnCloseMetrics = document.getElementById('btn-close-metrics');
const btnAddStream = document.getElementById('btn-add-stream');
const btnRemoveStream = document.getElementById('btn-remove-stream');
const btnDetachAll = document.getElementById('btn-detach-all');
const participantCountEl = document.getElementById('participant-count');
const memberCountEl = document.getElementById('member-count');
const memberListEl = document.getElementById('member-list');
const chatMessagesEl = document.getElementById('chat-messages');

// State
const players = new Map(); // streamId -> { player, element, tile }
const detachedStreams = new Set();
const activeStreamIds = [];
let streams = [];
let metricsCollector;

// Fake chat messages
const fakeChatMessages = [
  { author: 'river of the sea', text: '\u{1F30A}\u{1F30A}\u{1F30A}', time: '4:12' },
  { author: 'Andy John', text: 'not my choice', time: '4:13', system: false },
  { author: null, text: 'lildyckilla7 joined the chat room', time: '4:14', system: true },
  { author: 'ratsubie', text: 'andy lol but i am not gay', time: '4:15' },
  { author: null, text: 'vee_jessie joined the chat room', time: '4:16', system: true },
  { author: null, text: 'cool_antarctica joined the chat room', time: '4:16', system: true },
];

// ── Init ────────────────────────────────────────────────────────

async function init() {
  metricsCollector = new MetricsCollector();

  setupEventListeners();
  populateChat();
  await loadStreams();
  setupReattachListener();

  metricsCollector.start();
}

function setupEventListeners() {
  btnMetrics.addEventListener('click', () => {
    const isHidden = metricsOverlay.classList.toggle('hidden');
    metricsCollector.setOverlayVisible(!isHidden);
  });

  btnCloseMetrics.addEventListener('click', () => {
    metricsOverlay.classList.add('hidden');
    metricsCollector.setOverlayVisible(false);
  });

  btnAddStream.addEventListener('click', () => addStream());
  btnRemoveStream.addEventListener('click', () => removeStream());
  btnDetachAll.addEventListener('click', () => detachAllVideos());
}

// ── Stream loading ──────────────────────────────────────────────

async function loadStreams() {
  try {
    const res = await fetch(`${SERVER_URL}/api/streams`);
    streams = await res.json();
  } catch (e) {
    console.error('Failed to fetch streams:', e);
    videoGrid.innerHTML = '<div style="color:#888;padding:20px;text-align:center;">Cannot connect to server at localhost:3001.<br>Make sure the server is running.</div>';
    return;
  }

  const initialStreams = streams.slice(0, DEFAULT_STREAM_COUNT);

  // Stagger init — start each player 500ms apart to avoid resource contention
  for (let i = 0; i < initialStreams.length; i++) {
    const stream = initialStreams[i];
    activeStreamIds.push(stream.id);
    if (i > 0) await new Promise(r => setTimeout(r, 500));
    createVideoTile(stream);
  }

  updateUI();
}

// ── UI state ────────────────────────────────────────────────────

function updateUI() {
  const count = activeStreamIds.length;
  participantCountEl.textContent = count;
  memberCountEl.textContent = `(${count})`;
  updateGridLayout(count);

  const activeStreams = activeStreamIds.map(id => streams.find(s => s.id === id)).filter(Boolean);
  populateMembers(activeStreams);

  btnAddStream.disabled = activeStreamIds.length >= streams.length;
  btnRemoveStream.disabled = activeStreamIds.length <= 1;
}

function addStream() {
  const next = streams.find(s => !activeStreamIds.includes(s.id));
  if (!next) return;

  createVideoTile(next);
  activeStreamIds.push(next.id);
  updateUI();
}

function removeStream() {
  if (activeStreamIds.length <= 1) return;

  for (let i = activeStreamIds.length - 1; i >= 0; i--) {
    const id = activeStreamIds[i];
    if (!detachedStreams.has(id)) {
      const entry = players.get(id);
      if (entry) {
        entry.player.destroy();
        metricsCollector.unregisterPlayer(id);
        entry.tile.remove();
        players.delete(id);
      }
      activeStreamIds.splice(i, 1);
      updateUI();
      return;
    }
  }
}

function updateGridLayout(count) {
  videoGrid.className = '';
  videoGrid.classList.add(`grid-${Math.min(count, 12)}`);
}

// ── Detach all ──────────────────────────────────────────────────

async function detachAllVideos() {
  // Collect all attached streams
  const toDetach = activeStreamIds
    .filter(id => !detachedStreams.has(id))
    .map(id => streams.find(s => s.id === id))
    .filter(Boolean);

  if (toDetach.length === 0) return;

  // Destroy all players in main window first
  for (const stream of toDetach) {
    const entry = players.get(stream.id);
    if (entry) {
      entry.player.destroy();
      metricsCollector.unregisterPlayer(stream.id);

      // Turn tile into placeholder
      const tile = entry.tile;
      tile.classList.add('detached');
      tile.innerHTML = '';

      const label = document.createElement('div');
      label.className = 'detached-label';
      label.textContent = `${stream.name}\n(detached)`;

      const overlay = document.createElement('div');
      overlay.className = 'tile-overlay';

      const nameSpan = document.createElement('span');
      nameSpan.className = 'tile-name';
      nameSpan.textContent = stream.name;

      const returnBtn = document.createElement('button');
      returnBtn.className = 'tile-btn';
      returnBtn.title = 'Return to room';
      returnBtn.innerHTML = '\u2B8B';
      returnBtn.addEventListener('click', () => reattachVideo(stream));

      overlay.appendChild(nameSpan);
      overlay.appendChild(returnBtn);
      tile.appendChild(label);
      tile.appendChild(overlay);

      detachedStreams.add(stream.id);
      players.delete(stream.id);
    }
  }

  // Ask main process to create all windows tiled across the screen
  const streamList = toDetach.map(s => ({
    streamId: s.id,
    streamName: s.name,
    streamUrl: s.url
  }));

  await window.electronAPI.detachAll(streamList);
}

// ── Video tile ──────────────────────────────────────────────────

function createVideoTile(stream) {
  const { tile, video } = buildTileDOM(stream);
  videoGrid.appendChild(tile);

  const player = new HLSPlayer(video, stream.url);
  player.init();

  players.set(stream.id, { player, element: video, tile });
  metricsCollector.registerPlayer(stream.id, player);
}

function buildTileDOM(stream) {
  const tile = document.createElement('div');
  tile.className = 'video-tile';
  tile.id = `tile-${stream.id}`;
  tile.dataset.streamId = stream.id;

  const video = document.createElement('video');
  video.autoplay = true;
  video.playsInline = true;
  video.muted = true;

  const overlay = document.createElement('div');
  overlay.className = 'tile-overlay';

  const name = document.createElement('span');
  name.className = 'tile-name';
  name.textContent = stream.name;

  const detachBtn = document.createElement('button');
  detachBtn.className = 'tile-btn';
  detachBtn.title = 'Pop out to separate window';
  detachBtn.innerHTML = '\u2B08';
  detachBtn.addEventListener('click', () => detachVideo(stream));

  overlay.appendChild(name);
  overlay.appendChild(detachBtn);
  tile.appendChild(video);
  tile.appendChild(overlay);

  return { tile, video };
}

// ── Detach / Reattach ───────────────────────────────────────────

async function detachVideo(stream) {
  const entry = players.get(stream.id);
  if (!entry) return;

  const startTime = performance.now();

  entry.player.destroy();
  metricsCollector.unregisterPlayer(stream.id);

  const tile = entry.tile;
  tile.classList.add('detached');
  tile.innerHTML = '';

  const label = document.createElement('div');
  label.className = 'detached-label';
  label.textContent = `${stream.name}\n(detached)`;

  const overlay = document.createElement('div');
  overlay.className = 'tile-overlay';

  const nameSpan = document.createElement('span');
  nameSpan.className = 'tile-name';
  nameSpan.textContent = stream.name;

  const returnBtn = document.createElement('button');
  returnBtn.className = 'tile-btn';
  returnBtn.title = 'Return to room';
  returnBtn.innerHTML = '\u2B8B';
  returnBtn.addEventListener('click', () => reattachVideo(stream));

  overlay.appendChild(nameSpan);
  overlay.appendChild(returnBtn);
  tile.appendChild(label);
  tile.appendChild(overlay);

  detachedStreams.add(stream.id);
  players.delete(stream.id);

  await window.electronAPI.detachVideo({
    streamId: stream.id,
    streamName: stream.name,
    streamUrl: stream.url
  });

  const elapsed = (performance.now() - startTime).toFixed(0);
  console.log(`Detach latency for ${stream.name}: ${elapsed}ms`);
}

async function reattachVideo(stream) {
  const startTime = performance.now();
  await window.electronAPI.reattachVideo(stream.id);
  restoreTile(stream);
  const elapsed = (performance.now() - startTime).toFixed(0);
  console.log(`Reattach latency for ${stream.name}: ${elapsed}ms`);
}

function restoreTile(stream) {
  const tile = document.getElementById(`tile-${stream.id}`);
  if (!tile) return;

  tile.classList.remove('detached');
  tile.innerHTML = '';

  const video = document.createElement('video');
  video.autoplay = true;
  video.playsInline = true;
  video.muted = true;

  const overlay = document.createElement('div');
  overlay.className = 'tile-overlay';

  const name = document.createElement('span');
  name.className = 'tile-name';
  name.textContent = stream.name;

  const detachBtn = document.createElement('button');
  detachBtn.className = 'tile-btn';
  detachBtn.title = 'Pop out to separate window';
  detachBtn.innerHTML = '\u2B08';
  detachBtn.addEventListener('click', () => detachVideo(stream));

  overlay.appendChild(name);
  overlay.appendChild(detachBtn);
  tile.appendChild(video);
  tile.appendChild(overlay);

  const player = new HLSPlayer(video, stream.url);
  player.init();

  players.set(stream.id, { player, element: video, tile });
  metricsCollector.registerPlayer(stream.id, player);
  detachedStreams.delete(stream.id);
}

function setupReattachListener() {
  window.electronAPI.onVideoReattached((streamId) => {
    const stream = streams.find(s => s.id === streamId);
    if (stream) {
      restoreTile(stream);
    }
  });
}

// ── Chat & Members (stubs) ──────────────────────────────────────

function populateChat() {
  for (const msg of fakeChatMessages) {
    const div = document.createElement('div');
    div.className = `chat-msg ${msg.system ? 'system' : ''}`;
    if (msg.system) {
      div.textContent = msg.text;
    } else {
      div.innerHTML = `<span class="msg-author">${msg.author}</span><span class="msg-time">${msg.time}</span><br>${msg.text}`;
    }
    chatMessagesEl.appendChild(div);
  }
  chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
}

function populateMembers(activeStreams) {
  memberListEl.innerHTML = '';
  for (const stream of activeStreams) {
    const item = document.createElement('div');
    item.className = 'member-item';

    const avatar = document.createElement('div');
    avatar.className = 'member-avatar';
    avatar.textContent = stream.name.charAt(stream.name.length - 1);

    const name = document.createElement('span');
    name.className = 'member-name';
    name.textContent = stream.name;

    const status = document.createElement('span');
    status.className = 'member-status broadcasting';

    item.appendChild(avatar);
    item.appendChild(name);
    item.appendChild(status);
    memberListEl.appendChild(item);
  }
}

// Start
init();
