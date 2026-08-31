"""
predict_router.py
------------------
Drop this file next to your existing main.py, then add two lines to
main.py:

    from predict_router import router as predict_router
    app.include_router(predict_router)

This exposes:  GET /api/predict/{symbol}
e.g.           GET /api/predict/RELIANCE
"""

from concurrent.futures import ThreadPoolExecutor

from fastapi import APIRouter, HTTPException

from predict_service import get_prediction

router = APIRouter()
_executor = ThreadPoolExecutor(max_workers=2)  # keeps training/predict off the event loop


@router.get("/api/predict/{symbol}")
async def predict(symbol: str):
    import asyncio
    loop = asyncio.get_event_loop()
    try:
        result = await loop.run_in_executor(_executor, get_prediction, symbol)
        return result
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Prediction failed: {e}")