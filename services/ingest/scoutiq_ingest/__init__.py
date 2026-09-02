"""Optional Playwright-based ingest service for ScoutIQ.

Fetches configured pages, normalises them into ScoutIQ's provider payload
shape, and writes them to ``RAW_DATA_ROOT/inbox``. The main application picks
the files up through its built-in ``local-file`` provider, which means this
service can be replaced or removed without touching application code.
"""

__version__ = "0.1.0"
