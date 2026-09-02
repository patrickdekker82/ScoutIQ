# syntax=docker/dockerfile:1
#
# Optional Python analytics service (§82).
#
# Separate image because the numerical stack is large and most installations
# never need it. Nothing in ScoutIQ requires this container to be running.

FROM python:3.12-slim-bookworm

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    ANALYTICS_PORT=8000

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY scoutiq_analytics ./scoutiq_analytics

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/health').status==200 else 1)"

ENTRYPOINT ["python", "-m", "scoutiq_analytics"]
