#!/bin/bash
docker exec deploy-web-1 sh -c '
  echo "=== Bundle file ==="
  ls -la /app/static/app/assets/
  echo "=== Searches in bundle ==="
  for term in "Account Settings" "Sign Out" "showUserMenu" "showMenu" "Workspaces"; do
    count=$(grep -o "$term" /app/static/app/assets/index-*.js 2>/dev/null | wc -l)
    echo "  $term: $count occurrences"
  done
'
