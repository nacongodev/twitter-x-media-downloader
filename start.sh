#!/bin/bash
cd backend

# Simple approach: just try python directly (Nixpacks should make it available)
exec python -m uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}