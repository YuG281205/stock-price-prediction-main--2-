"""
features.py
------------
Turns raw OHLCV (open/high/low/close/volume) data into a feature table
that a regression model can learn from. No external TA library required -
everything is plain pandas so it's easy to read and modify.

Input:  DataFrame with columns ["open","high","low","close","volume"]
        indexed by date, sorted ascending.
Output: same DataFrame with extra feature columns appended.
"""

import numpy as np
import pandas as pd


def _rsi(close: pd.Series, period: int = 14) -> pd.Series:
    delta = close.diff()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)
    avg_gain = gain.ewm(alpha=1 / period, min_periods=period, adjust=False).mean()
    avg_loss = loss.ewm(alpha=1 / period, min_periods=period, adjust=False).mean()
    rs = avg_gain / avg_loss.replace(0, np.nan)
    rsi = 100 - (100 / (1 + rs))
    return rsi.fillna(50)


def _macd(close: pd.Series, fast: int = 12, slow: int = 26, signal: int = 9):
    ema_fast = close.ewm(span=fast, adjust=False).mean()
    ema_slow = close.ewm(span=slow, adjust=False).mean()
    macd_line = ema_fast - ema_slow
    signal_line = macd_line.ewm(span=signal, adjust=False).mean()
    hist = macd_line - signal_line
    return macd_line, signal_line, hist


def _atr(df: pd.DataFrame, period: int = 14) -> pd.Series:
    high, low, close = df["high"], df["low"], df["close"]
    prev_close = close.shift(1)
    tr = pd.concat(
        [high - low, (high - prev_close).abs(), (low - prev_close).abs()], axis=1
    ).max(axis=1)
    return tr.ewm(alpha=1 / period, min_periods=period, adjust=False).mean()


def add_technical_indicators(df: pd.DataFrame) -> pd.DataFrame:
    """Adds a standard set of technical-analysis features in place-ish
    (returns a new DataFrame, original is not mutated)."""
    df = df.copy()
    close = df["close"]

    # --- Trend / moving averages ---
    for w in (5, 10, 20, 50):
        df[f"sma_{w}"] = close.rolling(w).mean()
        df[f"ema_{w}"] = close.ewm(span=w, adjust=False).mean()

    # --- Momentum ---
    df["rsi_14"] = _rsi(close, 14)
    macd_line, signal_line, hist = _macd(close)
    df["macd"] = macd_line
    df["macd_signal"] = signal_line
    df["macd_hist"] = hist

    # --- Volatility ---
    df["atr_14"] = _atr(df, 14)
    bb_mid = close.rolling(20).mean()
    bb_std = close.rolling(20).std()
    df["bb_upper"] = bb_mid + 2 * bb_std
    df["bb_lower"] = bb_mid - 2 * bb_std
    df["bb_width"] = (df["bb_upper"] - df["bb_lower"]) / bb_mid

    # --- Returns / lag features ---
    for lag in (1, 2, 3, 5, 10):
        df[f"return_{lag}d"] = close.pct_change(lag)
        df[f"close_lag_{lag}"] = close.shift(lag)

    df["volatility_10d"] = close.pct_change().rolling(10).std()

    # --- Volume ---
    if "volume" in df.columns:
        df["volume_sma_10"] = df["volume"].rolling(10).mean()
        df["volume_change"] = df["volume"].pct_change()

    # --- Candle shape (today, as context for tomorrow's move) ---
    df["day_range_pct"] = (df["high"] - df["low"]) / df["close"]
    df["gap_pct"] = (df["open"] - close.shift(1)) / close.shift(1)

    # Guard against inf values from any division above (e.g. a stale/zero
    # price row in the source data causing a divide-by-zero). XGBoost will
    # hard-fail on inf, so convert to NaN here and let the caller's
    # dropna() remove those rows.
    df = df.replace([np.inf, -np.inf], np.nan)

    return df


FEATURE_COLUMNS = [
    "sma_5", "sma_10", "sma_20", "sma_50",
    "ema_5", "ema_10", "ema_20", "ema_50",
    "rsi_14", "macd", "macd_signal", "macd_hist",
    "atr_14", "bb_upper", "bb_lower", "bb_width",
    "return_1d", "return_2d", "return_3d", "return_5d", "return_10d",
    "close_lag_1", "close_lag_2", "close_lag_3", "close_lag_5", "close_lag_10",
    "volatility_10d", "volume_sma_10", "volume_change",
    "day_range_pct", "gap_pct",
]