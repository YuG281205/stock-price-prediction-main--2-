import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).parent / "users.db"

def init_db():
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute('''
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                email TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL
            )
        ''')
        conn.execute('''
            CREATE TABLE IF NOT EXISTS watchlists (
                user_id INTEGER NOT NULL,
                symbol TEXT NOT NULL,
                PRIMARY KEY (user_id, symbol),
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        ''')

init_db()

def get_user_by_email(email: str):
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        return conn.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()

def create_user(name: str, email: str, password_hash: str):
    with sqlite3.connect(DB_PATH) as conn:
        cursor = conn.cursor()
        try:
            cursor.execute(
                "INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)",
                (name, email, password_hash)
            )
            conn.commit()
            return cursor.lastrowid
        except sqlite3.IntegrityError:
            return None

def get_user_watchlist(user_id: int):
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        cur = conn.execute("SELECT symbol FROM watchlists WHERE user_id = ?", (user_id,))
        return [row["symbol"] for row in cur.fetchall()]

def toggle_user_watchlist(user_id: int, symbol: str) -> bool:
    """Toggles a symbol in the user's watchlist. Returns True if added, False if removed."""
    with sqlite3.connect(DB_PATH) as conn:
        # Check if it exists
        cur = conn.execute("SELECT 1 FROM watchlists WHERE user_id = ? AND symbol = ?", (user_id, symbol))
        exists = cur.fetchone() is not None
        if exists:
            conn.execute("DELETE FROM watchlists WHERE user_id = ? AND symbol = ?", (user_id, symbol))
            return False
        else:
            conn.execute("INSERT INTO watchlists (user_id, symbol) VALUES (?, ?)", (user_id, symbol))
            return True

def get_user_by_id(user_id: int):
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        return conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
