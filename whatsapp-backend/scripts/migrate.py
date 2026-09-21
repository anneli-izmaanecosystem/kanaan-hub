"""Applies every .sql file in migrations/, in filename order. Each file is idempotent
(CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS), so re-running is safe.

Usage: python scripts/migrate.py
Reads DATABASE_URL from the environment or .env (see app/config.py).
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import psycopg2

from app.config import get_settings

MIGRATIONS_DIR = Path(__file__).resolve().parent.parent / "migrations"


def main():
    settings = get_settings()
    conn = psycopg2.connect(settings.database_url)
    conn.autocommit = False
    try:
        with conn.cursor() as cur:
            for path in sorted(MIGRATIONS_DIR.glob("*.sql")):
                print(f"applying {path.name} ...")
                cur.execute(path.read_text())
        conn.commit()
        print("done.")
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    main()
