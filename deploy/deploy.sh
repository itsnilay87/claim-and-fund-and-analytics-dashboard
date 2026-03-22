#!/bin/bash
# ─────────────────────────────────────────────────────────
#  Deploy Claim Analytics Platform to Hetzner server
#  Usage: ./deploy.sh <server-ip> [ssh-key-path]
#
#  Example:
#    ./deploy.sh 168.119.42.100
#    ./deploy.sh 168.119.42.100 ~/.ssh/hetzner_key
# ─────────────────────────────────────────────────────────

set -euo pipefail

SERVER="${1:?Usage: ./deploy.sh <server-ip> [ssh-key-path]}"
SSH_KEY="${2:-$HOME/.ssh/id_rsa}"
IMAGE_NAME="claim-analytics"
CONTAINER_NAME="claim-analytics"

echo "═══════════════════════════════════════════════════"
echo "  Deploying $IMAGE_NAME to $SERVER"
echo "═══════════════════════════════════════════════════"

# ── 1. Build Docker image locally ──
echo ""
echo "▸ Building Docker image..."
cd "$(dirname "$0")/.."
docker build -t "$IMAGE_NAME" -f deploy/Dockerfile .

# ── 2. Save and transfer ──
echo ""
echo "▸ Saving and transferring image (this may take a few minutes)..."
docker save "$IMAGE_NAME" | gzip > /tmp/${IMAGE_NAME}.tar.gz
IMAGE_SIZE=$(du -h /tmp/${IMAGE_NAME}.tar.gz | cut -f1)
echo "  Image size: $IMAGE_SIZE"

scp -i "$SSH_KEY" /tmp/${IMAGE_NAME}.tar.gz "root@${SERVER}:/tmp/"

# ── 3. Load and run on server ──
echo ""
echo "▸ Loading image and starting container on server..."
ssh -i "$SSH_KEY" "root@${SERVER}" << REMOTE_EOF
  set -e

  echo "  Loading Docker image..."
  docker load < /tmp/${IMAGE_NAME}.tar.gz
  rm -f /tmp/${IMAGE_NAME}.tar.gz

  echo "  Stopping existing container (if any)..."
  docker stop ${CONTAINER_NAME} 2>/dev/null || true
  docker rm ${CONTAINER_NAME} 2>/dev/null || true

  echo "  Starting new container..."
  docker run -d \
    --name ${CONTAINER_NAME} \
    -p 80:80 \
    -v claim-analytics-runs:/app/server/runs \
    --restart unless-stopped \
    ${IMAGE_NAME}

  echo ""
  echo "  ✓ Container running"
  echo "  ✓ Access at http://\$(curl -s ifconfig.me)"
  echo "  ✓ Logs: docker logs -f ${CONTAINER_NAME}"
REMOTE_EOF

# ── Cleanup local temp file ──
rm -f /tmp/${IMAGE_NAME}.tar.gz

echo ""
echo "═══════════════════════════════════════════════════"
echo "  Deployment complete!"
echo "═══════════════════════════════════════════════════"
