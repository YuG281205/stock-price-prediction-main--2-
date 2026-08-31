"""
predict_service.py
-------------------
Given a symbol, returns predictions for THREE horizons - short/medium/
long term - plus the shared context (price history, indicators,
backtest accuracy per horizon) needed to render the comparison panel
and charts on the frontend.

Trains a model bundle on first request per symbol if one isn't cached
on disk yet, then reuses it. Retrains automatically once a day.
"""

import time
from pathlib import Path

import joblib

from features import add_technical_indicators, FEATURE_COLUMNS
from train_model import fetch_history, train_and_save, MODELS_DIR, HORIZONS

MAX_MODEL_AGE_SECONDS = 60 * 60 * 24  # retrain daily


def _model_path(symbol: str) -> Path:
    return MODELS_DIR / f"{symbol.upper()}.joblib"


def _ensure_model(symbol: str) -> dict:
    path = _model_path(symbol)
    if not path.exists() or (time.time() - path.stat().st_mtime) > MAX_MODEL_AGE_SECONDS:
        train_and_save(symbol)
    bundle = joblib.load(path)
    # Backward-compat guard: if an old single-horizon model file is still on
    # disk from before this update, force a retrain into the new format.
    if "models" not in bundle:
        train_and_save(symbol)
        bundle = joblib.load(path)
    return bundle


def get_prediction(symbol: str, years: int = 1) -> dict:
    symbol = symbol.upper().strip()
    bundle = _ensure_model(symbol)
    models = bundle["models"]
    all_metrics = bundle["metrics"]

    raw = fetch_history(symbol, years=years)  # only need a recent window for live features
    feat = add_technical_indicators(raw)
    feat = feat.dropna(subset=FEATURE_COLUMNS)
    if feat.empty:
        raise ValueError(f"Not enough recent data to build features for {symbol}")

    latest_row = feat.iloc[[-1]]
    latest_close = float(latest_row["close"].iloc[0])
    latest_date = latest_row.index[-1]
    X_live = latest_row[FEATURE_COLUMNS]
    atr = float(latest_row["atr_14"].iloc[0])
    volatility_10d_pct = float(latest_row["volatility_10d"].iloc[0]) * 100

    # Dynamic noise floor: don't call BUY/SELL on a change smaller than the
    # stock's own recent volatility would produce by chance.
    signal_threshold_pct = max(0.5, volatility_10d_pct * 0.5)

    horizons_out = {}
    for horizon_name, horizon_days in HORIZONS.items():
        model = models[horizon_name]
        metrics = all_metrics[horizon_name]

        predicted_close = float(model.predict(X_live)[0])
        residual_std = metrics.get("residual_std", latest_close * 0.02)
        low_est = predicted_close - 1.96 * residual_std
        high_est = predicted_close + 1.96 * residual_std
        change_pct = (predicted_close - latest_close) / latest_close * 100

        if change_pct > signal_threshold_pct:
            signal = "BUY"
            target_price = round(predicted_close, 2)
            stop_loss = round(latest_close - 1.5 * atr, 2)
        elif change_pct < -signal_threshold_pct:
            signal = "SELL"
            target_price = round(predicted_close, 2)
            stop_loss = round(latest_close + 1.5 * atr, 2)
        else:
            signal = "HOLD"
            target_price = None
            stop_loss = None

        horizons_out[horizon_name] = {
            "horizon_days": horizon_days,
            "predicted_close": round(predicted_close, 2),
            "predicted_change_pct": round(change_pct, 2),
            "expected_range_95": {"low": round(low_est, 2), "high": round(high_est, 2)},
            "signal": signal,
            "target_price": target_price,
            "stop_loss": stop_loss,
            "model_backtest": {
                "mae": metrics["mae"],
                "mape_pct": metrics["mape_pct"],
                "directional_accuracy_pct": metrics["directional_accuracy_pct"],
            },
        }

    avg_gap_pct = float(feat["gap_pct"].tail(30).mean())
    expected_open = latest_close * (1 + avg_gap_pct)

    rsi = float(latest_row["rsi_14"].iloc[0])
    macd_hist = float(latest_row["macd_hist"].iloc[0])
    trend = "bullish" if macd_hist > 0 and rsi > 50 else "bearish" if macd_hist < 0 and rsi < 50 else "neutral"

    history_tail = feat.tail(30)
    history = [
        {
            "date": str(idx.date()), 
            "open": round(float(row["open"]), 2),
            "high": round(float(row["high"]), 2),
            "low": round(float(row["low"]), 2),
            "close": round(float(row["close"]), 2)
        }
        for idx, row in history_tail.iterrows()
    ]

    return {
        "symbol": symbol,
        "as_of_date": str(latest_date.date()),
        "last_close": round(latest_close, 2),
        "expected_open": round(expected_open, 2),
        "history": history,
        "horizons": horizons_out,   # {"short_term": {...}, "medium_term": {...}, "long_term": {...}}
        "indicators": {
            "rsi_14": round(rsi, 1),
            "macd_hist": round(macd_hist, 3),
            "trend_signal": trend,
            "volatility_10d_pct": round(float(latest_row["volatility_10d"].iloc[0]) * 100, 2),
        },
    }