# Python analytics worker (optional)

An optional companion service for the heavier numerical work of §82: kernel
density estimation, clustering, dimensionality reduction and physical tracking
aggregates, using pandas, numpy, scipy and scikit-learn.

**ScoutIQ does not need it.** The TypeScript engine already computes metrics,
percentiles, DNA, roles, similarity, team style, club fit, zones and grid/hexbin/
KDE heatmaps. This service exists for the cases where the Python numerical stack
is genuinely better - large tracking datasets, clustering experiments, new
models - and is disabled unless `ANALYTICS_WORKER_URL` is set.

## Running

```bash
docker compose --profile analytics up -d
# or locally:
pip install -r requirements.txt
python -m scoutiq_analytics --port 8000
```

Then point the application at it:

```env
ANALYTICS_WORKER_URL=http://analytics-worker:8000
```

## Endpoints

| Method | Path | Body | Returns |
| --- | --- | --- | --- |
| `GET` | `/health` | - | `{ "status": "ok" }` |
| `POST` | `/kde` | `{ points: [{x, y, weight}], bandwidth, cols, rows }` | Density grid on the canonical 105 × 68 pitch |
| `POST` | `/cluster` | `{ vectors: {id: [..]}, clusters }` | K-means cluster per id, plus inertia |
| `POST` | `/tracking-summary` | `{ frames: [...], frameRateHz }` | Per-player distance, high-speed distance, sprints, max speed |

All coordinates are canonical metres, the same contract as the rest of ScoutIQ
(§33). The service is stateless: it holds no database connection and stores
nothing, so it can be scaled or removed at will.
