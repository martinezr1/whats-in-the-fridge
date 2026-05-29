#!/bin/sh
mkdir -p /data/uploads
chown -R witf /data
exec gosu witf uvicorn main:app --host 0.0.0.0 --port 8082
