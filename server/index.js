const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 3001;
const MEDIA_DIR = path.join(__dirname, '..', 'media', 'streams');

app.use(cors());

// Serve HLS segments with correct MIME types
app.use('/streams', express.static(MEDIA_DIR, {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.m3u8')) {
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    } else if (filePath.endsWith('.ts')) {
      res.setHeader('Content-Type', 'video/mp2t');
    }
    // Disable caching for live-like behavior
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  }
}));

// API: list available streams
app.get('/api/streams', (req, res) => {
  if (!fs.existsSync(MEDIA_DIR)) {
    return res.json([]);
  }

  const streams = [];
  const dirs = fs.readdirSync(MEDIA_DIR, { withFileTypes: true });

  for (const dir of dirs) {
    if (dir.isDirectory()) {
      const m3u8Path = path.join(MEDIA_DIR, dir.name, 'index.m3u8');
      if (fs.existsSync(m3u8Path)) {
        streams.push({
          id: dir.name,
          name: `Participant ${dir.name}`,
          url: `http://localhost:${PORT}/streams/${dir.name}/index.m3u8`
        });
      }
    }
  }

  // Sort by numeric id
  streams.sort((a, b) => parseInt(a.id) - parseInt(b.id));
  res.json(streams);
});

app.listen(PORT, () => {
  console.log(`HLS server running at http://localhost:${PORT}`);
  console.log(`Streams directory: ${MEDIA_DIR}`);

  if (!fs.existsSync(MEDIA_DIR) || fs.readdirSync(MEDIA_DIR).length === 0) {
    console.log('\nNo streams found. Run "npm run prepare-hls" first.');
    console.log('Make sure you have .mp4 files in media/source/');
  } else {
    const count = fs.readdirSync(MEDIA_DIR).filter(d =>
      fs.statSync(path.join(MEDIA_DIR, d)).isDirectory()
    ).length;
    console.log(`Serving ${count} stream(s)`);
  }
});
