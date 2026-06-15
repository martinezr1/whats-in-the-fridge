#!/bin/sh
mkdir -p /data/uploads
exec uvicorn main:app --host 0.0.0.0 --port 8082
