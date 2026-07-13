import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "backend"))

try:
    from main import app as apex_app
    app = apex_app
except Exception as e:
    import traceback
    from fastapi import FastAPI
    app = FastAPI(title="APEX Dashboard (fallback)")

    @app.get("/api/health")
    async def health():
        return {
            "status": "error",
            "message": f"Import failed: {type(e).__name__}: {str(e)}",
            "traceback": traceback.format_exc().split("\n"),
        }

    @app.api_route("/api/{path:path}", methods=["GET", "POST"])
    async def catch_all(path: str):
        return {"error": True, "message": f"Import failed: {type(e).__name__}: {str(e)}"}

    @app.api_route("/{path:path}", methods=["GET", "POST"])
    async def root_catch(path: str):
        return catch_all(path)
