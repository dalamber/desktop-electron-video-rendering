#!/bin/bash
# Converts .mp4 files in media/source/ into HLS streams in media/streams/
# Creates up to 12 participant streams by cycling through source files

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SOURCE_DIR="$SCRIPT_DIR/../media/source"
OUTPUT_DIR="$SCRIPT_DIR/../media/streams"

# Check ffmpeg
if ! command -v ffmpeg &> /dev/null; then
    echo "Error: ffmpeg is not installed. Install it with: brew install ffmpeg"
    exit 1
fi

# Check source files
MP4_FILES=("$SOURCE_DIR"/*.mp4)
if [ ! -f "${MP4_FILES[0]}" ]; then
    echo "Error: No .mp4 files found in $SOURCE_DIR"
    echo "Place your test video files there and run again."
    exit 1
fi

echo "Found ${#MP4_FILES[@]} source file(s):"
printf '  %s\n' "${MP4_FILES[@]}"

# Clean output
rm -rf "$OUTPUT_DIR"
mkdir -p "$OUTPUT_DIR"

MAX_STREAMS=12
FILE_COUNT=${#MP4_FILES[@]}

for i in $(seq 0 $((MAX_STREAMS - 1))); do
    # Cycle through source files
    FILE_INDEX=$((i % FILE_COUNT))
    SOURCE="${MP4_FILES[$FILE_INDEX]}"
    STREAM_DIR="$OUTPUT_DIR/$i"
    mkdir -p "$STREAM_DIR"

    echo "Creating stream $i from $(basename "$SOURCE")..."

    ffmpeg -y -stream_loop -1 -i "$SOURCE" \
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
        -loglevel warning

    echo "  Stream $i ready"
done

echo ""
echo "Done! Created $MAX_STREAMS streams in $OUTPUT_DIR"
echo "Start the server with: cd server && npm start"
