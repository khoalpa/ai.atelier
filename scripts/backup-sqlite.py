"""Copy a SQLite database using SQLite's transactional online-backup API."""
import sqlite3
import sys
from pathlib import Path
source,target=map(Path,sys.argv[1:3])
with sqlite3.connect(source.resolve().as_uri()+'?mode=ro',uri=True,timeout=30) as src:
    if src.execute('PRAGMA quick_check').fetchone()[0]!='ok':
        raise ValueError('Cơ sở dữ liệu nguồn không toàn vẹn.')
    with sqlite3.connect(target,timeout=30) as dst:
        src.backup(dst,pages=256,sleep=.05)
        if dst.execute('PRAGMA quick_check').fetchone()[0]!='ok':
            raise ValueError('Cơ sở dữ liệu sao chép không toàn vẹn.')
