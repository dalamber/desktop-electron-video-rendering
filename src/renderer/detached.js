/**
 * Detached video window logic
 */

const params = new URLSearchParams(window.location.search);
const streamId = params.get('streamId');
const streamName = params.get('streamName');
const streamUrl = params.get('streamUrl');

document.getElementById('stream-name').textContent = streamName;
document.title = streamName;

const video = document.getElementById('video');
const player = new HLSPlayer(video, streamUrl);
player.init();

document.getElementById('btn-return').addEventListener('click', async () => {
  player.destroy();
  await window.electronAPI.reattachVideo(streamId);
});

window.addEventListener('beforeunload', () => {
  player.destroy();
});
