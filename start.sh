#!/bin/bash
cd backend

# Try different Python paths in Railway/Nixpacks environment
if command -v python >/dev/null 2>&1; then
    exec python -m uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}
elif [ -f /opt/venv/bin/python ]; then
    exec /opt/venv/bin/python -m uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}
elif [ -f /usr/local/bin/python ]; then
    exec /usr/local/bin/python -m uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}
else
    echo "Python not found in any expected location" >&2
    exit 1
fi