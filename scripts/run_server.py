"""Run the app server: WhatsApp webhook + dashboard REST API + the built dashboard.

Usage: python scripts/run_server.py
In production this should run under systemd (see deploy/) behind a domain with TLS,
since Meta requires HTTPS for webhook callback URLs.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import uvicorn

if __name__ == "__main__":
    uvicorn.run("api.app:app", host="0.0.0.0", port=8001, reload=False)
