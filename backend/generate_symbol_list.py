"""
generate_symbol_list.py
------------------------
Pulls the full constituent list for an NSE index (default: NIFTY 500)
using the same `nse` package your main.py already depends on, and
writes it to a plain text file — one symbol per line — ready to feed
into batch_train.py.

Usage:
    python generate_symbol_list.py
    python generate_symbol_list.py --index "NIFTY 50" --out symbols_nifty50.txt
"""

import argparse
from pathlib import Path

from nse import NSE

BASE_DIR = Path(__file__).resolve().parent
DOWNLOAD_DIR = BASE_DIR / "nse_data"
DOWNLOAD_DIR.mkdir(exist_ok=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--index", default="NIFTY 500")
    parser.add_argument("--out", default="symbols_nifty500.txt")
    args = parser.parse_args()

    with NSE(download_folder=str(DOWNLOAD_DIR)) as nse:
        result = nse.listEquityStocksByIndex(index=args.index)

    rows = result.get("data", [])
    symbols = sorted({row["symbol"] for row in rows if row.get("symbol")})

    out_path = BASE_DIR / args.out
    out_path.write_text("\n".join(symbols))

    print(f"Wrote {len(symbols)} symbols from '{args.index}' -> {out_path}")


if __name__ == "__main__":
    main()