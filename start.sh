#!/bin/bash
# One-shot script: prepare HLS streams (if needed) + start server
set -e

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
SOURCE_DIR="$ROOT_DIR/media/source"
OUTPUT_DIR="$ROOT_DIR/media/streams"
SERVER_DIR="$ROOT_DIR/server"
MAX_STREAMS=12

# ── Check dependencies ──────────────────────────────────────────
for cmd in node ffmpeg ffprobe; do
    if ! command -v "$cmd" &>/dev/null; then
        echo "❌ $cmd not found. Install it first."
        exit 1
    fi
done

# ── Install server deps if needed ───────────────────────────────
if [ ! -d "$SERVER_DIR/node_modules" ]; then
    echo "📦 Installing server dependencies..."
    (cd "$SERVER_DIR" && npm install --silent)
fi

# ── Prepare HLS (skip if streams already exist) ─────────────────
if [ -d "$OUTPUT_DIR/0" ] && [ -f "$OUTPUT_DIR/0/index.m3u8" ]; then
    EXISTING=$(find "$OUTPUT_DIR" -maxdepth 1 -type d | wc -l | tr -d ' ')
    EXISTING=$((EXISTING - 1)) # subtract the parent dir
    echo "✅ HLS streams already prepared ($EXISTING streams found), skipping."
else
    # Find source video files (mp4, avi, mkv, mov)
    SOURCE_FILES=()
    for ext in mp4 avi mkv mov; do
        for f in "$SOURCE_DIR"/*.$ext; do
            [ -f "$f" ] && SOURCE_FILES+=("$f")
        done
    done

    if [ ${#SOURCE_FILES[@]} -eq 0 ]; then
        echo "❌ No video files found in $SOURCE_DIR"
        echo "   Put .mp4/.avi/.mkv/.mov files there and re-run."
        exit 1
    fi

    FILE_COUNT=${#SOURCE_FILES[@]}
    echo "🎬 Found $FILE_COUNT source file(s), creating $MAX_STREAMS HLS streams..."

    rm -rf "$OUTPUT_DIR"
    mkdir -p "$OUTPUT_DIR"

    # Get durations so we can pick random offsets
    declare -a DURATIONS
    for f in "${SOURCE_FILES[@]}"; do
        dur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$f" | cut -d. -f1)
        DURATIONS+=("${dur:-3000}")
    done

    for i in $(seq 0 $((MAX_STREAMS - 1))); do
        FILE_INDEX=$((i % FILE_COUNT))
        SOURCE="${SOURCE_FILES[$FILE_INDEX]}"
        DUR="${DURATIONS[$FILE_INDEX]}"

        STREAM_DIR="$OUTPUT_DIR/$i"
        mkdir -p "$STREAM_DIR"

        # For streams 0..(FILE_COUNT-1) start from 0; for duplicates pick random offset
        if [ "$i" -lt "$FILE_COUNT" ]; then
            SS=0
        else
            # Random offset: between 10% and 60% of duration
            RANGE=$((DUR * 50 / 100))
            OFFSET_MIN=$((DUR * 10 / 100))
            SS=$((OFFSET_MIN + RANDOM % (RANGE + 1)))
        fi

        echo "  Stream $i ← $(basename "$SOURCE") [offset ${SS}s / ${DUR}s]"

        ffmpeg -y -ss "$SS" -i "$SOURCE" \
            -t 300 \
            -c:v libx264 -preset ultrafast -tune zerolatency \
            -vf "scale=640:480:force_original_aspect_ratio=decrease,pad=640:480:(ow-iw)/2:(oh-ih)/2,drawtext=text='P$i':fontsize=48:fontcolor=white:borderw=2:x=10:y=10" \
            -b:v 800k -maxrate 800k -bufsize 1200k \
            -g 30 -keyint_min 30 \
            -c:a aac -b:a 64k -ar 44100 -ac 1 \
            -f hls \
            -hls_time 2 \
            -hls_list_size 0 \
            -hls_segment_filename "$STREAM_DIR/seg_%03d.ts" \
            "$STREAM_DIR/index.m3u8" \
            -loglevel warning &

        # Run up to 4 ffmpeg processes in parallel
        if (( (i + 1) % 4 == 0 )); then
            wait
            echo "  ✓ Batch done"
        fi
    done
    wait
    echo "✅ All $MAX_STREAMS streams ready."
fi

# ── Start HLS server ────────────────────────────────────────────
echo ""
echo "🚀 Starting HLS server on http://localhost:3001 ..."
cd "$SERVER_DIR" && exec node index.js
