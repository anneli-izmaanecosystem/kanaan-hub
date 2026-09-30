FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /srv

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY app ./app
COPY migrations ./migrations
COPY scripts ./scripts

# All configuration (DATABASE_URL, WHATSAPP_*, secrets) comes from the environment at
# runtime; .env is excluded by .dockerignore so nothing sensitive is baked into the image,
# which gets pushed to a public registry.
RUN useradd --uid 10001 --no-create-home app
USER 10001

EXPOSE 8000
# One worker keeps memory minimal; proxy headers are trusted from the ingress controller.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1", "--proxy-headers", "--forwarded-allow-ips", "*"]
