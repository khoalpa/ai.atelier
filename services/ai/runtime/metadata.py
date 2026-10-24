"""Execution records share the versioned metadata store with the local API.

Python owns execution records; the API owns queue and project records. JSON is
used only before migration or after an explicit export back to legacy storage.
"""
import json
import os
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path


def _location(file):
    file = Path(file).resolve()
    for home in file.parents:
        database = home / 'metadata.sqlite3'
        if database.is_file():
            key = file.relative_to(home).as_posix()
            if not key.startswith('jobs/') or not key.endswith('.json'):
                return None
            return database, key
    return None


def _connection(file):
    location = _location(file)
    if not location:
        return None, None
    database, key = location
    db = sqlite3.connect(database, timeout=20)
    if db.execute("SELECT value FROM metadata WHERE key='active'").fetchone() != ('1',):
        db.close()
        return None, None
    return db, key


def read(file, fallback=None):
    db, key = _connection(file)
    if db:
        try:
            row = db.execute('SELECT data FROM documents WHERE key=?', (key,)).fetchone()
            return json.loads(row[0]) if row else fallback
        finally:
            db.close()
    file = Path(file)
    return json.loads(file.read_text(encoding='utf-8')) if file.exists() else fallback


def write(file, value):
    data = json.dumps(value, ensure_ascii=False)
    db, key = _connection(file)
    if db:
        try:
            with db:
                db.execute('''INSERT INTO documents(key,kind,source_id,status,data,revision,updated_at)
                VALUES(?,?,?,?,?,1,?) ON CONFLICT(key) DO UPDATE SET
                data=excluded.data,status=excluded.status,revision=documents.revision+1,updated_at=excluded.updated_at''',
                (key, 'jobs', str(value.get('sourceId', '')), str(value.get('status', '')), data, datetime.now(timezone.utc).isoformat()))
        finally:
            db.close()
        return
    file = Path(file)
    file.parent.mkdir(parents=True, exist_ok=True)
    temp = file.with_name(file.name + '.' + uuid.uuid4().hex + '.tmp')
    try:
        temp.write_text(data, encoding='utf-8')
        os.replace(temp, file)
    finally:
        temp.unlink(missing_ok=True)


def exists(file):
    sentinel = object()
    return read(file, sentinel) is not sentinel


def files(directory):
    directory = Path(directory)
    db, key = _connection(directory / 'probe.json')
    if not db:
        return list(directory.glob('*.json'))
    try:
        return [directory / row[0].split('/')[-1] for row in db.execute("SELECT key FROM documents WHERE kind='jobs'")]
    finally:
        db.close()
