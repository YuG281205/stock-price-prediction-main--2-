"""
train_model.py
---------------
Trains THREE closing-price predictors per symbol - short/medium/long
term - matching the horizon structure used by reference sites like
StockSense360 (short/medium/long term tabs) instead of a single
next-day number.

  short_term  -> 1 trading day ahead   (~next session)
  medium_term -> 5 trading days ahead  (~1 week)
  long_term   -> 20 trading days ahead (~1 month)

Data source: yfinance (free, no API key). Indian NSE tickers use a
".NS" suffix, e.g. RELIANCE -> "RELIANCE.NS".

Usage:
    python train_model.py RELIANCE
    python train_model.py TCS --years 5
"""

import argparse
import warnings
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import yfinance as yf
from sklearn.metrics import mean_absolute_error, mean_squared_error

from features import add_technical_indicators, FEATURE_COLUMNS

warnings.filterwarnings("ignore")

MODELS_DIR = Path(__file__).resolve().parent / "models"
MODELS_DIR.mkdir(exist_ok=True)

# Trading-day horizons for each tab shown in the UI.
HORIZONS = {
    "short_term": 1,
    "medium_term": 5,
    "long_term": 20,
}


def _get_model():
    """Prefer XGBoost if installed (usually more accurate), else fall back
    to sklearn's GradientBoostingRegressor which ships with scikit-learn."""
    try:
        from xgboost import XGBRegressor
        return XGBRegressor(
            n_estimators=400,
            max_depth=4,
            learning_rate=0.03,
            subsample=0.8,
            colsample_bytree=0.8,
            random_state=42,
        )
    except ImportError:
        from sklearn.ensemble import GradientBoostingRegressor
        return GradientBoostingRegressor(
            n_estimators=300, max_depth=3, learning_rate=0.05, random_state=42
        )


def fetch_history(symbol: str, years: int = 5) -> pd.DataFrame:
    ticker = symbol if symbol.upper().endswith((".NS", ".BO")) else f"{symbol.upper()}.NS"
    df = yf.download(ticker, period=f"{years}y", interval="1d", auto_adjust=True, progress=False)
    if df.empty:
        raise ValueError(f"No data returned for {ticker}. Check the symbol.")
    df = df.rename(columns=str.lower)
    # yfinance sometimes returns MultiIndex columns for a single ticker; flatten if so
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = [c[0] for c in df.columns]
    df = df[["open", "high", "low", "close", "volume"]]
    return df


def build_dataset(df: pd.DataFrame, horizon_days: int):
    """horizon_days: how many trading days ahead the target close is."""
    feat = add_technical_indicators(df)
    feat["target_close"] = feat["close"].shift(-horizon_days)
    feat = feat.dropna(subset=FEATURE_COLUMNS + ["target_close"])
    X = feat[FEATURE_COLUMNS]
    y = feat["target_close"]
    return X, y, feat


def time_split(X, y, test_size=0.2):
    n_test = int(len(X) * test_size)
    return X.iloc[:-n_test], X.iloc[-n_test:], y.iloc[:-n_test], y.iloc[-n_test:]


def _train_one_horizon(raw: pd.DataFrame, horizon_days: int, symbol: str, horizon_name: str):
    X, y, feat = build_dataset(raw, horizon_days)
    X_train, X_test, y_train, y_test = time_split(X, y)

    model = _get_model()
    model.fit(X_train, y_train)

    preds = model.predict(X_test)
    mae = mean_absolute_error(y_test, preds)
    rmse = np.sqrt(mean_squared_error(y_test, preds))
    mape = float(np.mean(np.abs((y_test.values - preds) / y_test.values)) * 100)

    prev_close = X_test["close_lag_1"].values
    actual_dir = np.sign(y_test.values - prev_close)
    pred_dir = np.sign(preds - prev_close)
    directional_acc = float(np.mean(actual_dir == pred_dir) * 100)

    residual_std = float(np.std(y_test.values - preds))

    metrics = {
        "symbol": symbol.upper(),
        "horizon": horizon_name,
        "horizon_days": horizon_days,
        "n_train": len(X_train),
        "n_test": len(X_test),
        "mae": round(mae, 2),
        "rmse": round(rmse, 2),
        "mape_pct": round(mape, 2),
        "directional_accuracy_pct": round(directional_acc, 2),
        "residual_std": round(residual_std, 2),
    }
    return model, metrics


def train_and_save(symbol: str, years: int = 5) -> dict:
    print(f"Fetching {years}y of history for {symbol}...")
    raw = fetch_history(symbol, years)

    models = {}
    all_metrics = {}
    for horizon_name, horizon_days in HORIZONS.items():
        model, metrics = _train_one_horizon(raw, horizon_days, symbol, horizon_name)
        models[horizon_name] = model
        all_metrics[horizon_name] = metrics
        print(f"  [{horizon_name}, {horizon_days}d ahead] "
              f"MAPE={metrics['mape_pct']}% dir_acc={metrics['directional_accuracy_pct']}%")

    bundle = {
        "models": models,               # {"short_term": model, "medium_term": model, "long_term": model}
        "feature_columns": FEATURE_COLUMNS,
        "metrics": all_metrics,         # {"short_term": {...}, "medium_term": {...}, "long_term": {...}}
    }
    out_path = MODELS_DIR / f"{symbol.upper()}.joblib"
    joblib.dump(bundle, out_path)

    print(f"Saved model -> {out_path}")
    # keep a flat return for callers that just want a quick summary
    return all_metrics["short_term"]


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("symbol", help="NSE symbol, e.g. RELIANCE, TCS, INFY")
    parser.add_argument("--years", type=int, default=5)
    args = parser.parse_args()
    train_and_save(args.symbol, args.years)