"""Environment-driven configuration.

No path, host or credential is hard-coded: the service is as portable as the
rest of ScoutIQ.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field


def _targets() -> list[str]:
    raw = os.environ.get("INGEST_TARGETS", "")
    return [item.strip() for item in raw.split(",") if item.strip()]


@dataclass(frozen=True)
class Config:
    raw_data_root: str = field(default_factory=lambda: os.environ.get("RAW_DATA_ROOT", "/data/raw"))
    targets: list[str] = field(default_factory=_targets)
    timeout_ms: int = field(default_factory=lambda: int(os.environ.get("INGEST_TIMEOUT_MS", "30000")))
    interval_seconds: int = field(
        default_factory=lambda: int(os.environ.get("INGEST_INTERVAL_SECONDS", "3600"))
    )
    user_agent: str = field(
        default_factory=lambda: os.environ.get("INGEST_USER_AGENT", "ScoutIQ-Ingest/0.1")
    )

    @property
    def inbox(self) -> str:
        return os.path.join(self.raw_data_root, "inbox")


def load_config() -> Config:
    return Config()
