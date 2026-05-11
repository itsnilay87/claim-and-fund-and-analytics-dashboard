#!/bin/bash
set -e
cd /opt/claim-analytics-platform
echo "Login source marker:"
grep -n "navigate('/forgot-password')" app/src/pages/Login.jsx || true
echo "App route alias marker:"
grep -n "/reset-password" app/src/App.jsx || true
