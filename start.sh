#!/bin/bash
cd backend

echo "Debug: Current directory: $(pwd)" >&2
echo "Debug: Files in /opt/: $(ls -la /opt/ 2>/dev/null || echo 'No /opt')" >&2
echo "Debug: Files in /usr/bin/: $(ls -la /usr/bin/python* 2>/dev/null || echo 'No python in /usr/bin')" >&2
echo "Debug: Which python: $(which python 2>/dev/null || echo 'python not in PATH')" >&2
echo "Debug: Which python3: $(which python3 2>/dev/null || echo 'python3 not in PATH')" >&2
echo "Debug: PATH: $PATH" >&2

# Try to find Python in common locations
PYTHON_CMD=""
if command -v python >/dev/null 2>&1; then
    PYTHON_CMD="python"
    echo "Debug: Found python in PATH" >&2
elif command -v python3 >/dev/null 2>&1; then
    PYTHON_CMD="python3"
    echo "Debug: Found python3 in PATH" >&2
elif [ -f /opt/venv/bin/python ]; then
    PYTHON_CMD="/opt/venv/bin/python"
    echo "Debug: Found python in /opt/venv/bin/" >&2
elif [ -f /usr/local/bin/python ]; then
    PYTHON_CMD="/usr/local/bin/python"
    echo "Debug: Found python in /usr/local/bin/" >&2
elif [ -f /usr/bin/python ]; then
    PYTHON_CMD="/usr/bin/python"
    echo "Debug: Found python in /usr/bin/" >&2
elif [ -f /usr/bin/python3 ]; then
    PYTHON_CMD="/usr/bin/python3"
    echo "Debug: Found python3 in /usr/bin/" >&2
else
    echo "Python not found in any expected location" >&2
    echo "Debug: Available commands: $(ls /usr/bin/ | grep python || echo 'No python commands')" >&2
    exit 1
fi

echo "Debug: Using Python command: $PYTHON_CMD" >&2
exec $PYTHON_CMD -m uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}