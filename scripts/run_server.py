"""Run the app server: dashboard REST API + the built dashboard.

Usage: python scripts/run_server.py
In production this should run under systemd (see deploy/).
"""

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import uvicorn

if __name__ == "__main__":
    port = int(os.getenv("PORT", "8000"))
    uvicorn.run("api.app:app", host="0.0.0.0", port=port, reload=False)
