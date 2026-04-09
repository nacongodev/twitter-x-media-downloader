#!/bin/bash
cd backend
# Activate virtual environment if it exists
if [ -f /opt/venv/bin/activate ]; then
    source /opt/venv/bin/activate
fi
# Default PORT to 8000 if not set
PORT=${PORT:-8000}
exec python3 -m uvicorn main:app --host 0.0.0.0 --port $PORT