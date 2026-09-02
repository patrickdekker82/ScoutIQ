"""Numerical routines.

Kept free of HTTP concerns so they can be unit-tested and reused from a
notebook.
"""

from __future__ import annotations

from typing import Any, Iterable

import numpy as np

from . import PITCH_LENGTH_M, PITCH_WIDTH_M


def kde_grid(
    points: Iterable[dict[str, float]],
    bandwidth: float = 6.0,
    cols: int = 24,
    rows: int = 16,
) -> dict[str, Any]:
    """Gaussian KDE over the canonical pitch, returned as a normalised grid.

    Uses scipy's gaussian_kde when there are enough distinct points for a
    covariance estimate, and falls back to an explicit isotropic kernel when
    there are not - a single shot must still produce a sensible surface.
    """
    data = [
        (float(p["x"]), float(p["y"]), float(p.get("weight", 1.0)))
        for p in points
        if _in_bounds(p)
    ]

    cell_w = PITCH_LENGTH_M / cols
    cell_h = PITCH_WIDTH_M / rows
    xs = (np.arange(cols) + 0.5) * cell_w
    ys = (np.arange(rows) + 0.5) * cell_h
    grid_x, grid_y = np.meshgrid(xs, ys, indexing="ij")

    if not data:
        values = np.zeros_like(grid_x)
    else:
        px = np.array([d[0] for d in data])
        py = np.array([d[1] for d in data])
        weights = np.array([d[2] for d in data])
        values = _density(px, py, weights, grid_x, grid_y, bandwidth)

    peak = float(values.max())
    if peak > 0:
        values = values / peak

    cells = [
        {
            "col": int(col),
            "row": int(row),
            "x": round(float(grid_x[col, row]), 2),
            "y": round(float(grid_y[col, row]), 2),
            "value": round(float(values[col, row]), 4),
        }
        for col in range(cols)
        for row in range(rows)
    ]

    return {
        "algorithm": "GAUSSIAN_KDE",
        "cols": cols,
        "rows": rows,
        "bandwidth": bandwidth,
        "sampleSize": len(data),
        "cells": cells,
    }


def _density(
    px: np.ndarray,
    py: np.ndarray,
    weights: np.ndarray,
    grid_x: np.ndarray,
    grid_y: np.ndarray,
    bandwidth: float,
) -> np.ndarray:
    distinct = len({(round(x, 3), round(y, 3)) for x, y in zip(px, py)})

    if distinct >= 3:
        try:
            from scipy.stats import gaussian_kde

            kernel = gaussian_kde(np.vstack([px, py]), weights=weights)
            # Express the bandwidth in metres rather than in scipy's scaled units.
            kernel.set_bandwidth(bandwidth / max(px.std() or 1.0, 1e-6) / 10)
            flat = kernel(np.vstack([grid_x.ravel(), grid_y.ravel()]))
            return flat.reshape(grid_x.shape)
        except Exception:  # noqa: BLE001 - fall through to the explicit kernel
            pass

    denominator = 2 * bandwidth * bandwidth
    values = np.zeros_like(grid_x)
    for x, y, weight in zip(px, py, weights):
        squared = (grid_x - x) ** 2 + (grid_y - y) ** 2
        values += weight * np.exp(-squared / denominator)
    return values


def cluster_players(vectors: dict[str, list[float]], clusters: int = 4) -> dict[str, Any]:
    """K-means over style vectors, for grouping players by profile."""
    from sklearn.cluster import KMeans

    ids = list(vectors.keys())
    if len(ids) < clusters or clusters < 1:
        return {"clusters": {}, "inertia": None, "note": "not enough players to cluster"}

    matrix = np.array([vectors[key] for key in ids], dtype=float)
    model = KMeans(n_clusters=clusters, n_init=10, random_state=42).fit(matrix)

    return {
        "clusters": {key: int(label) for key, label in zip(ids, model.labels_)},
        "centroids": [[round(float(v), 3) for v in row] for row in model.cluster_centers_],
        "inertia": round(float(model.inertia_), 3),
    }


HIGH_SPEED_MS = 5.5
SPRINT_MS = 7.0


def tracking_summary(frames: list[dict[str, Any]], frame_rate_hz: float = 10.0) -> dict[str, Any]:
    """Per-player physical output from tracking frames (§25 Physical, §37).

    Frame-to-frame displacements beyond human speed are discarded rather than
    inflating the totals - tracking data always contains a few glitches.
    """
    dt = 1.0 / max(frame_rate_hz, 1.0)
    max_step = 12.0 * dt

    state: dict[str, dict[str, Any]] = {}

    for frame in frames:
        for player in frame.get("players", []):
            player_id = player.get("playerExternalId") or player.get("playerId")
            if not player_id:
                continue

            entry = state.setdefault(
                player_id,
                {
                    "playerId": player_id,
                    "teamId": player.get("teamExternalId") or player.get("teamId"),
                    "frames": 0,
                    "sumX": 0.0,
                    "sumY": 0.0,
                    "distanceM": 0.0,
                    "highSpeedDistanceM": 0.0,
                    "sprintCount": 0,
                    "maxSpeedMs": 0.0,
                    "last": None,
                    "sprinting": False,
                },
            )

            x, y = float(player["x"]), float(player["y"])
            entry["frames"] += 1
            entry["sumX"] += x
            entry["sumY"] += y

            if entry["last"] is not None:
                step = float(np.hypot(x - entry["last"][0], y - entry["last"][1]))
                if step <= max_step:
                    speed = float(player.get("speedMs") or step / dt)
                    entry["distanceM"] += step
                    if speed >= HIGH_SPEED_MS:
                        entry["highSpeedDistanceM"] += step
                    entry["maxSpeedMs"] = max(entry["maxSpeedMs"], speed)
                    if speed >= SPRINT_MS and not entry["sprinting"]:
                        entry["sprintCount"] += 1
                        entry["sprinting"] = True
                    elif speed < SPRINT_MS:
                        entry["sprinting"] = False

            entry["last"] = (x, y)

    players = []
    for entry in state.values():
        frames_seen = max(entry["frames"], 1)
        players.append(
            {
                "playerId": entry["playerId"],
                "teamId": entry["teamId"],
                "frames": entry["frames"],
                "avgX": round(entry["sumX"] / frames_seen, 2),
                "avgY": round(entry["sumY"] / frames_seen, 2),
                "distanceM": round(entry["distanceM"], 2),
                "highSpeedDistanceM": round(entry["highSpeedDistanceM"], 2),
                "sprintCount": entry["sprintCount"],
                "maxSpeedMs": round(entry["maxSpeedMs"], 2),
            }
        )

    return {"players": sorted(players, key=lambda p: p["playerId"])}


def _in_bounds(point: dict[str, float]) -> bool:
    try:
        x, y = float(point["x"]), float(point["y"])
    except (KeyError, TypeError, ValueError):
        return False
    return 0 <= x <= PITCH_LENGTH_M and 0 <= y <= PITCH_WIDTH_M
