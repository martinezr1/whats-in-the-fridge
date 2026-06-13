FROM python:3.11-slim

# Install dependencies
COPY backend/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt

# Copy application code
COPY backend/ /app/backend/
COPY frontend/ /app/frontend/

# Create non-root user; pre-create /data/uploads so the named volume
# inherits witf ownership on first mount (no root needed at runtime)
RUN adduser --system --no-create-home --uid 1001 witf \
    && mkdir -p /data/uploads \
    && chown -R witf /app /data

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

WORKDIR /app/backend

EXPOSE 8082

USER witf
ENTRYPOINT ["/entrypoint.sh"]
