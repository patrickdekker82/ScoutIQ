# syntax=docker/dockerfile:1
#
# Optional Playwright-based ingest service.
#
# Everything Playwright needs (Python, browsers, system libraries) lives in
# this image, so no operator ever installs Python or browser dependencies on a
# host. The service is entirely optional: ScoutIQ imports data without it.

FROM mcr.microsoft.com/playwright/python:v1.49.0-noble

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    RAW_DATA_ROOT=/data/raw

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY scoutiq_ingest ./scoutiq_ingest

# Writes normalised JSON into RAW_DATA_ROOT/inbox, where ScoutIQ's built-in
# local-file provider picks it up. The two services share nothing but a path.
ENTRYPOINT ["python", "-m", "scoutiq_ingest"]
CMD ["--loop"]
