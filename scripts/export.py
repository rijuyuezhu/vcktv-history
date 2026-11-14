#!/usr/bin/env python3
"""Export closed, public VC-KTV sessions as a self-contained static snapshot."""

import argparse
import json
import re
import shutil
import sqlite3
import tempfile
from collections import Counter
from pathlib import Path
from urllib.parse import quote, urlsplit

EVENT_ID = re.compile(r"^[a-zA-Z0-9_-]{1,60}$")
COVER_EXTS = (".jpg", ".jpeg", ".png", ".webp")
SITE = Path(__file__).resolve().parent.parent


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def read_songs(db_path):
    with sqlite3.connect(
        "file:" + quote(str(db_path.resolve()), safe="/") + "?mode=ro", uri=True
    ) as db:
        db.row_factory = sqlite3.Row
        columns = {row[1] for row in db.execute("PRAGMA table_info(songs)")}
        frozen = "archive_order" in columns and db.execute(
            "SELECT 1 FROM songs WHERE archive_order IS NOT NULL LIMIT 1"
        ).fetchone()
        order = (
            "ORDER BY CASE WHEN s.archive_order IS NULL THEN 1 ELSE 0 END, "
            "s.archive_order,s.requested_at,s.id"
            if frozen
            else """ORDER BY
            CASE WHEN s.status IN ('played','skipped') THEN 0
                 WHEN s.status IN ('playing','closed_interrupted') THEN 1
                 WHEN s.status='cancelled' THEN 3 ELSE 2 END,
            CASE WHEN s.status IN ('played','skipped') THEN s.played_at END,
            s.requested_at,s.id"""
        )
        return [
            dict(row)
            for row in db.execute(
                """SELECT s.id,s.title,s.status,s.source_type,s.source_id,s.bvid,
                   s.page,s.uploader,s.duration,s.requested_at,
                   CASE WHEN s.status IN ('played','skipped')
                        THEN s.played_at END AS played_at,
                   g.name AS requester
                   FROM songs s JOIN guests g ON g.id=s.requester """
                + order
            )
        ]


def cover_path(folder, song_id):
    parent = folder / "media" / "covers"
    if parent.is_symlink() or (folder / "media").is_symlink():
        return None
    for ext in COVER_EXTS:
        path = parent / (str(song_id) + ext)
        if path.is_file() and not path.is_symlink():
            return path
    return None


def valid_links(links):
    result = []
    for link in links:
        parsed = urlsplit(link["url"])
        if parsed.scheme != "https" or not parsed.hostname or parsed.username:
            raise ValueError("Playlist URL must be absolute HTTPS")
        result.append({
            "platform": str(link["platform"]),
            "label": str(link["label"]),
            "url": str(link["url"]),
        })
    return result


def export(data_root, site, playlists):
    source = data_root / "sessions"
    if not source.is_dir():
        raise FileNotFoundError(source)
    config = read_json(playlists)
    events = []
    missing = []
    with tempfile.TemporaryDirectory(prefix=".export-", dir=site) as temporary:
        staging = Path(temporary)
        (staging / "data" / "events").mkdir(parents=True)
        (staging / "covers").mkdir()
        for folder in sorted(source.iterdir()):
            if not folder.is_dir() or folder.is_symlink():
                continue
            if not EVENT_ID.fullmatch(folder.name):
                continue
            info = folder / "info.json"
            db_path = folder / "room.sqlite3"
            if not info.is_file() or not db_path.is_file():
                continue
            event = read_json(info)
            if event.get("id") != folder.name:
                raise ValueError("Mismatched event ID: " + folder.name)
            if event.get("status") != "closed" or event.get("public") is not True:
                continue

            songs = read_songs(db_path)
            counts = Counter(song["status"] for song in songs)
            for i, song in enumerate(songs, start=1):
                song["order"] = i
                cover = cover_path(folder, song["id"])
                if cover:
                    relative = "covers/" + folder.name + "/" + str(song["id"]) + cover.suffix.lower()
                    output = staging / relative
                    output.parent.mkdir(exist_ok=True)
                    shutil.copyfile(cover, output)
                    song["cover"] = relative
                else:
                    song["cover"] = None
                    missing.append((folder.name, song["id"]))
            summary = {
                "id": folder.name,
                "name": event.get("name") or folder.name,
                "created_at": event.get("created_at"),
                "closed_at": event.get("closed_at"),
                "song_count": len(songs),
                "played_count": counts["played"],
            }
            events.append(summary)
            details = {
                "event": summary,
                "playlists": valid_links(config.get(folder.name, [])),
                "songs": songs,
            }
            (staging / "data" / "events" / (folder.name + ".json")).write_text(
                json.dumps(details, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
            )
        events.sort(key=lambda e: (e.get("closed_at") or "", e["id"]), reverse=True)
        (staging / "data" / "events.json").write_text(
            json.dumps({"events": events}, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        for name in ("covers", "data"):
            target = site / name
            if target.is_symlink():
                raise ValueError("Refusing to replace symlink: " + str(target))
            if target.exists():
                shutil.rmtree(target)
            shutil.move(str(staging / name), str(target))
    print("exported:", len(events), "public events,", sum(e["song_count"] for e in events), "songs")
    print("missing covers:", missing)
    return missing


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-root", type=Path, default=Path("~/.local/share/vc-ktv").expanduser())
    parser.add_argument("--site", type=Path, default=SITE)
    parser.add_argument("--playlists", type=Path, default=SITE / "config" / "playlists.json")
    args = parser.parse_args()
    if export(args.data_root.expanduser(), args.site.resolve(), args.playlists.resolve()):
        raise SystemExit("Some covers are missing")


if __name__ == "__main__":
    main()
