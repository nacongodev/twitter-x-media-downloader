#!/bin/bash
cd backend
# Activate virtual environment if it exists
if [ -f /opt/venv/bin/activate ]; then
    source /opt/venv/bin/activate
fi
exec python -m uvicorn main:app --host 0.0.0.0 --port $PORT