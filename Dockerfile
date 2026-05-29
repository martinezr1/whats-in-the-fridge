FROM python:3.11-slim

# Install gosu for privilege dropping at runtime
RUN apt-get update && apt-get install -y --no-install-recommends gosu \
    && rm -rf /var/lib/apt/lists/*

# Install dependencies
COPY backend/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt

# Copy application code
COPY backend/ /app/backend/
COPY frontend/ /app/frontend/

# Create non-root user and set ownership
RUN adduser --system --no-create-home --uid 1001 witf \
    && mkdir -p /data/uploads \
    && chown -R witf /app

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

WORKDIR /app/backend

EXPOSE 8082

ENTRYPOINT ["/entrypoint.sh"]
