import sys
import os
import traceback
from pathlib import Path

# Debug info
print(f"[APEX] Python version: {sys.version}", flush=True)
print(f"[APEX] CWD: {os.getcwd()}", flush=True)
print(f"[APEX] File: {__file__}", flush=True)
print(f"[APEX] DIR: {Path(__file__).parent}", flush=True)
print(f"[APEX] Parent: {Path(__file__).parent.parent}", flush=True)
print(f"[APEX] Sys.path before: {sys.path}", flush=True)

sys.path.insert(0, str(Path(__file__).parent.parent))

print(f"[APEX] Sys.path after: {sys.path}", flush=True)

try:
    from main import app as apex_app
    print(f"[APEX] App loaded: {apex_app.title}", flush=True)
    app = apex_app
except Exception as e:
    print(f"[APEX] ERROR: {e}", flush=True)
    traceback.print_exc()
    raise
