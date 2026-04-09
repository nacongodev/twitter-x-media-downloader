#!/bin/bash
cd backend
# Activate virtual environment if it exists
if [ -f /opt/venv/bin/activate ]; then
    source /opt/venv/bin/activate
    exec python -m uvicorn main:app --host 0.0.0.0 --port $PORT
else
    # Fallback: try direct python path
    exec /opt/venv/bin/python -m uvicorn main:app --host 0.0.0.0 --port $PORT
fi