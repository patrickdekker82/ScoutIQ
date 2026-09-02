"""Turn scraped rows into ScoutIQ's provider payload shape.

Kept free of Playwright imports so it can be unit-tested without a browser.
"""

from __future__ import annotations

from typing import Any, Iterable


def _number(value: Any, default: float = 0.0) -> float:
    try:
        return float(str(value).replace(",", ".").strip())
    except (TypeError, ValueError):
        return default


def normalise_player(row: dict[str, Any]) -> dict[str, Any]:
    name = str(row.get("name", "")).strip()
    first, _, last = name.partition(" ")
    return {
        "externalId": str(row.get("id") or name).strip(),
        "firstName": first or name,
        "lastName": last or "",
        "position": str(row.get("position", "MF")).strip() or "MF",
        "nationality": row.get("nationality"),
        "teamName": row.get("team"),
        "teamCountry": row.get("country"),
    }


def build_payload(rows: Iterable[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    players = [normalise_player(row) for row in rows]
    return {"players": players, "matchStats": []}
