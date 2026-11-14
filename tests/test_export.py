"""Fast smoke tests for public-only archive export."""

import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from importlib.util import module_from_spec, spec_from_file_location

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "export.py"
spec = spec_from_file_location("static_export", SCRIPT)
module = module_from_spec(spec)
spec.loader.exec_module(module)


class ExportTests(unittest.TestCase):
    def test_public_closed_only_and_asset_copy(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            sessions = root / "source" / "sessions"
            site = root / "site"
            site.mkdir()
            config = root / "playlists.json"
            config.write_text("{}")
            for ident, status, public in [
                ("published", "closed", True),
                ("private", "closed", False),
                ("active", "active", True),
            ]:
                event = sessions / ident
                (event / "media" / "covers").mkdir(parents=True)
                (event / "info.json").write_text(
                    json.dumps({"id": ident, "name": ident, "status": status, "public": public})
                )
                with sqlite3.connect(event / "room.sqlite3") as db:
                    db.executescript(
                        """CREATE TABLE guests (id TEXT PRIMARY KEY,name TEXT);
                        CREATE TABLE songs (
                            id INTEGER PRIMARY KEY,title TEXT,status TEXT,source_type TEXT,
                            source_id TEXT,bvid TEXT,page INTEGER,uploader TEXT,duration INTEGER,
                            requested_at INTEGER,played_at INTEGER,requester TEXT,archive_order INTEGER
                        );"""
                    )
                    db.execute("INSERT INTO guests VALUES ('guest','Guest')")
                    db.execute(
                        "INSERT INTO songs VALUES (2,'Song','played','bilibili','',"
                        "'BV11234',1,'Uploader',90,2,4,'guest',1)"
                    )
                (event / "media" / "covers" / "2.jpg").write_bytes(b"\xff\xd8\xffphoto")
            missing = module.export(root / "source", site, config)
            self.assertFalse(missing)
            events = json.loads((site / "data" / "events.json").read_text())["events"]
            self.assertEqual([e["id"] for e in events], ["published"])
            detail = json.loads((site / "data" / "events" / "published.json").read_text())
            self.assertEqual(detail["songs"][0]["requester"], "Guest")
            self.assertEqual(detail["songs"][0]["order"], 1)
            self.assertEqual(detail["songs"][0]["cover"], "covers/published/2.jpg")
            self.assertTrue((site / "covers" / "published" / "2.jpg").is_file())
            self.assertFalse((site / "covers" / "private").exists())
            self.assertNotIn("lyrics", detail["songs"][0])
            self.assertNotIn("media_file", detail["songs"][0])

    def test_reject_insecure_playlist_url(self):
        with self.assertRaises(ValueError):
            module.valid_links([{"platform": "test", "label": "unsafe", "url": "javascript:alert(1)"}])


if __name__ == "__main__":
    unittest.main()
