"""
batch_train.py
---------------
Pre-trains models for many symbols at once, instead of relying on the
on-the-fly training in predict_service.py. Useful before a demo, or to
avoid the first-click delay for popular stocks.

Includes a delay between requests since yfinance hits Yahoo's public
endpoints, which will rate-limit / temporarily block you if you hammer
them with 500 requests back to back.

Usage:
    python batch_train.py                          # trains the default watchlist below
    python batch_train.py --file symbols.txt        # one symbol per line
    python batch_train.py --symbols RELIANCE TCS INFY
    python batch_train.py --file symbols.txt --delay 3 --years 3
"""

import argparse
import time
from datetime import datetime
from pathlib import Path

from train_model import train_and_save, MODELS_DIR

# A reasonable default watchlist — the stocks most likely to get clicked
# in a demo. Swap this out or pass --file with your own list (e.g. the
# full NIFTY 500 constituents, one symbol per line).
DEFAULT_WATCHLIST = [
    "RELIANCE", "TCS", "INFY", "HDFCBANK", "ICICIBANK", "SBIN",
    "ADANIENT", "ADANIPORTS", "TATAMOTORS", "TATASTEEL", "WIPRO",
    "BHARTIARTL", "ITC", "HINDUNILVR", "MARUTI", "AXISBANK",
    "KOTAKBANK", "LT", "SUNPHARMA", "BAJFINANCE",
]


def load_symbols(args) -> list[str]:
    if args.symbols:
        return [s.upper() for s in args.symbols]
    if args.file:
        with open(args.file) as f:
            return [line.strip().upper() for line in f if line.strip()]
    return DEFAULT_WATCHLIST


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--file", help="Path to a text file, one symbol per line")
    parser.add_argument("--symbols", nargs="+", help="Explicit list of symbols")
    parser.add_argument("--years", type=int, default=5)
    parser.add_argument("--delay", type=float, default=2.0, help="Seconds to wait between symbols")
    parser.add_argument("--retries", type=int, default=2, help="Retries per symbol on transient failures")
    parser.add_argument(
        "--force", action="store_true",
        help="Retrain even if a model file already exists (default: skip existing models, so you can safely re-run/resume a batch)",
    )
    args = parser.parse_args()

    symbols = load_symbols(args)

    if not args.force:
        before = len(symbols)
        symbols = [s for s in symbols if not (MODELS_DIR / f"{s}.joblib").exists()]
        skipped = before - len(symbols)
        if skipped:
            print(f"Skipping {skipped} symbols that already have a saved model (use --force to retrain them).")

    if not symbols:
        print("Nothing to train — all requested symbols already have models. Use --force to retrain.")
        return

    est_minutes = round(len(symbols) * (args.delay + 4) / 60, 1)  # ~4s assumed avg train time per symbol
    print(f"Training {len(symbols)} symbols, ~{args.delay}s delay between each. Rough estimate: {est_minutes} min.\n")

    results = []
    for i, symbol in enumerate(symbols, 1):
        print(f"[{i}/{len(symbols)}] {symbol} — {datetime.now().strftime('%H:%M:%S')}")
        last_error = None
        for attempt in range(1, args.retries + 2):  # first try + retries
            try:
                metrics = train_and_save(symbol, args.years)
                results.append((symbol, "OK", metrics["directional_accuracy_pct"]))
                last_error = None
                break
            except Exception as e:
                last_error = e
                if attempt <= args.retries:
                    wait = args.delay * attempt * 2
                    print(f"  attempt {attempt} failed ({e}); retrying in {wait:.0f}s...")
                    time.sleep(wait)
        if last_error is not None:
            print(f"  FAILED after {args.retries + 1} attempts: {last_error}")
            results.append((symbol, "FAILED", str(last_error)))
        if i < len(symbols):
            time.sleep(args.delay)

    print("\n--- Summary ---")
    ok = sum(1 for _, status, _ in results if status == "OK")
    print(f"{ok}/{len(results)} trained successfully.")
    for symbol, status, info in results:
        print(f"  {symbol:<12} {status:<8} {info}")


if __name__ == "__main__":
    main()