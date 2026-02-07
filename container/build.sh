#!/bin/bash
# Build the Guardian Core agent container image

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

IMAGE_NAME="guardian-core-agent"
TAG="${1:-latest}"

echo "Building Guardian Core agent container image..."
echo "Image: ${IMAGE_NAME}:${TAG}"

# Build shared package types
echo "Building @guardian/shared..."
(cd "$SCRIPT_DIR/shared" && npx tsc)

# Pre-copy shared package for Docker context
rm -rf "$SCRIPT_DIR/.shared-cache"
mkdir -p "$SCRIPT_DIR/.shared-cache"
cp -r "$SCRIPT_DIR/shared/dist" "$SCRIPT_DIR/.shared-cache/dist"
cp "$SCRIPT_DIR/shared/package.json" "$SCRIPT_DIR/.shared-cache/package.json"

# Build Docker image
docker build -t "${IMAGE_NAME}:${TAG}" .

echo ""
echo "Build complete!"
echo "Image: ${IMAGE_NAME}:${TAG}"
echo ""
echo "Test with:"
echo "  echo '{\"prompt\":\"What is 2+2?\",\"groupFolder\":\"test\",\"chatJid\":\"test@g.us\",\"isMain\":false}' | docker run -i ${IMAGE_NAME}:${TAG}"
