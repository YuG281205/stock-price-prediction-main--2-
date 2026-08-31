"""
NSE Live Dashboard - Backend
-----------------------------
Polls NSE's public market-watch endpoint (via the unofficial `nse` package)
for an entire index (default: NIFTY 500) in a single bulk call every few
seconds, and streams the results to connected browser clients over a
WebSocket. Also serves the static frontend.

Run with:
    uvicorn main:app --reload --port 8000
"""
from predict_router import router as predict_router
from auth_router import router as auth_router
import asyncio
import json
import logging
from datetime import datetime
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from nse import NSE

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("nse-dashboard")

BASE_DIR = Path(__file__).resolve().parent
DOWNLOAD_DIR = BASE_DIR / "nse_data"
DOWNLOAD_DIR.mkdir(exist_ok=True)
FRONTEND_DIR = BASE_DIR.parent / "frontend"

# ---- Config -----------------------------------------------------------
POLL_INTERVAL_SECONDS = 5       # how often to refresh the whole basket
INDEX_NAME = "NIFTY 500"        # change to "NIFTY 50", "NIFTY BANK", etc.
# ------------------------------------------------------------------------

app = FastAPI(title="NSE Live Dashboard")
app.include_router(predict_router)
app.include_router(auth_router)

latest_data: list[dict] = []
last_updated: Optional[str] = None
last_error: Optional[str] = None
connected_clients: set[WebSocket] = set()


def fetch_index_data() -> list[dict]:
    """Blocking call — run this inside a threadpool executor."""
    with NSE(download_folder=str(DOWNLOAD_DIR)) as nse:
        result = nse.listEquityStocksByIndex(index=INDEX_NAME)
    return result.get("data", [])


async def broadcast(message: dict) -> None:
    if not connected_clients:
        return
    payload = json.dumps(message, default=str)
    dead = set()
    for ws in connected_clients:
        try:
            await ws.send_text(payload)
        except Exception:
            dead.add(ws)
    connected_clients.difference_update(dead)


async def poll_loop() -> None:
    global latest_data, last_updated, last_error
    loop = asyncio.get_event_loop()
    while True:
        try:
            data = await loop.run_in_executor(None, fetch_index_data)
            latest_data = data
            last_updated = datetime.now().isoformat()
            last_error = None
            log.info("Refreshed %s (%d symbols)", INDEX_NAME, len(latest_data))
            await broadcast({
                "type": "update",
                "data": latest_data,
                "last_updated": last_updated,
                "index": INDEX_NAME,
            })
        except Exception as exc:  # NSE can rate-limit / block occasionally
            last_error = str(exc)
            log.warning("Poll failed: %s", exc)
            await broadcast({"type": "error", "message": last_error})
        await asyncio.sleep(POLL_INTERVAL_SECONDS)


@app.on_event("startup")
async def startup() -> None:
    asyncio.create_task(poll_loop())


@app.get("/api/stocks")
async def get_stocks():
    return {
        "data": latest_data,
        "last_updated": last_updated,
        "error": last_error,
        "index": INDEX_NAME,
    }


@app.websocket("/ws")
async def ws_endpoint(websocket: WebSocket):
    await websocket.accept()
    connected_clients.add(websocket)
    try:
        # send whatever we already have immediately on connect
        await websocket.send_text(json.dumps({
            "type": "update",
            "data": latest_data,
            "last_updated": last_updated,
            "index": INDEX_NAME,
        }, default=str))
        while True:
            # we don't expect messages from the client, but keep the
            # connection open and detect disconnects
            await websocket.receive_text()
    except WebSocketDisconnect:
        connected_clients.discard(websocket)


# Serve the frontend (index.html, etc.) at "/"
app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")
