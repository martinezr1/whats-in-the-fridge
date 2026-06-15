import http.client
import io
import ipaddress
import json
import os
import socket
import ssl
import uuid
import shutil
import urllib.parse
import urllib.request
from datetime import datetime, date, timezone
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, Depends, HTTPException, UploadFile, File, Form
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session
from PIL import Image

import models
import database

app = FastAPI(title="What's in the Fridge")

models.Base.metadata.create_all(bind=database.engine)

# Migrate existing DBs that predate added columns
with database.engine.connect() as _conn:
    for ddl in [
        "ALTER TABLE fridge_items ADD COLUMN quantity INTEGER NOT NULL DEFAULT 1",
        "ALTER TABLE fridge_items ADD COLUMN expiration_date DATE",
    ]:
        try:
            _conn.execute(text(ddl))
            _conn.commit()
        except Exception:
            pass

UPLOAD_DIR = Path("/data/uploads")
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

THUMBNAIL_SIZE = (400, 400)
MAX_IMAGE_BYTES = 10 * 1024 * 1024  # 10 MB
ALLOWED_FORMATS = {"JPEG", "PNG", "GIF", "WEBP"}
FORMAT_EXT = {"JPEG": ".jpg", "PNG": ".png", "GIF": ".gif", "WEBP": ".webp"}
Image.MAX_IMAGE_PIXELS = 50_000_000  # ~7000×7000; raises DecompressionBombError above this

SPOONACULAR_API_KEY = os.getenv("SPOONACULAR_API_KEY", "")

SUGGESTION_CACHE_FILE = Path("/data/suggestion_cache.json")

def _load_suggestion_cache() -> dict:
    try:
        return json.loads(SUGGESTION_CACHE_FILE.read_text())
    except Exception:
        return {}

def _save_suggestion_cache(cache: dict) -> None:
    try:
        tmp = SUGGESTION_CACHE_FILE.with_suffix(".tmp")
        tmp.write_text(json.dumps(cache))
        tmp.replace(SUGGESTION_CACHE_FILE)
    except Exception:
        pass

suggestion_cache: dict = _load_suggestion_cache()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:8082"],
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
    allow_headers=["Content-Type"],
)


# --- Schemas ---

class AddToFridgeRequest(BaseModel):
    expiration_date: Optional[str] = None


class FridgeItemOut(BaseModel):
    id: int
    saved_food_id: Optional[int]
    name: str
    description: str
    date_added: datetime
    image_path: Optional[str]
    active: bool
    quantity: int
    expiration_date: Optional[date] = None

    class Config:
        from_attributes = True


class SavedFoodOut(BaseModel):
    id: int
    name: str
    description: str
    default_image_path: Optional[str]
    created_at: datetime

    class Config:
        from_attributes = True


# --- Helpers ---

def _get_image_format(data: bytes) -> Optional[str]:
    try:
        fmt = Image.open(io.BytesIO(data)).format
        return fmt if fmt in ALLOWED_FORMATS else None
    except Exception:
        return None


def _resolve_safe(url: str):
    """
    Resolve the URL hostname once and validate the resulting IP is not private/loopback.
    Returns (scheme, ip, port, path, hostname) so the caller can connect directly to
    the pre-resolved IP — eliminating the DNS rebinding window between check and fetch.
    Returns None if the URL is unsafe or unparseable.
    """
    try:
        parsed = urllib.parse.urlparse(url)
        if parsed.scheme not in ("http", "https"):
            return None
        hostname = parsed.hostname
        if not hostname:
            return None
        ip = socket.gethostbyname(hostname)
        addr = ipaddress.ip_address(ip)
        if addr.is_private or addr.is_loopback or addr.is_link_local or addr.is_reserved:
            return None
        port = parsed.port or (443 if parsed.scheme == "https" else 80)
        path = parsed.path or "/"
        if parsed.query:
            path += "?" + parsed.query
        return (parsed.scheme, ip, port, path, hostname)
    except Exception:
        return None


def save_image(file: UploadFile) -> str:
    contents = file.file.read(MAX_IMAGE_BYTES + 1)
    if len(contents) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="Image too large (max 10 MB)")
    fmt = _get_image_format(contents)
    if fmt is None:
        raise HTTPException(status_code=415, detail="Invalid or unsupported image format")
    filename = f"{uuid.uuid4().hex}{FORMAT_EXT[fmt]}"
    dest = UPLOAD_DIR / filename
    dest.write_bytes(contents)
    try:
        with Image.open(dest) as img:
            img.thumbnail(THUMBNAIL_SIZE, Image.LANCZOS)
            img.save(dest)
    except Image.DecompressionBombError:
        dest.unlink(missing_ok=True)
        raise HTTPException(status_code=413, detail="Image dimensions too large")
    except Exception:
        pass
    return filename


def download_image(url: str) -> Optional[str]:
    dest = None
    try:
        # Follow redirects (CDNs like Spoonacular use them), but re-validate each
        # hop with _resolve_safe so SSRF protection is never bypassed.
        current_url = url
        for _ in range(5):
            resolved = _resolve_safe(current_url)
            if resolved is None:
                return None
            scheme, ip, port, path, hostname = resolved
            raw = socket.create_connection((ip, port), timeout=8)
            if scheme == "https":
                ctx = ssl.create_default_context()
                sock = ctx.wrap_socket(raw, server_hostname=hostname)
                conn = http.client.HTTPSConnection(hostname, timeout=8)
            else:
                sock = raw
                conn = http.client.HTTPConnection(ip, timeout=8)
            conn.sock = sock  # inject pre-connected socket; skips connect() / second DNS lookup
            conn.request("GET", path, headers={"User-Agent": "Mozilla/5.0", "Host": hostname})
            resp = conn.getresponse()
            if resp.status in (301, 302, 303, 307, 308):
                location = resp.getheader("Location")
                conn.close()
                if not location:
                    return None
                # Resolve relative redirects
                if location.startswith("/"):
                    current_url = f"{scheme}://{hostname}{location}"
                else:
                    current_url = location
                continue
            if resp.status != 200:
                conn.close()
                return None
            data = b""
            while chunk := resp.read(65536):
                data += chunk
                if len(data) > MAX_IMAGE_BYTES:
                    conn.close()
                    return None
            conn.close()
            break
        else:
            return None  # exceeded redirect limit
        fmt = _get_image_format(data)
        if fmt is None:
            return None
        filename = f"{uuid.uuid4().hex}{FORMAT_EXT[fmt]}"
        dest = UPLOAD_DIR / filename
        dest.write_bytes(data)
        try:
            with Image.open(dest) as img:
                img.thumbnail(THUMBNAIL_SIZE, Image.LANCZOS)
                img.save(dest)
        except Image.DecompressionBombError:
            dest.unlink(missing_ok=True)
            return None
        except Exception:
            pass
        return filename
    except Exception:
        if dest and dest.exists():
            dest.unlink()
        return None


# --- Fridge endpoints ---

@app.get("/api/fridge", response_model=list[FridgeItemOut])
def list_fridge(db: Session = Depends(database.get_db)):
    return (
        db.query(models.FridgeItem)
        .filter(models.FridgeItem.active == True)
        .order_by(models.FridgeItem.date_added.desc())
        .all()
    )


@app.post("/api/fridge", response_model=FridgeItemOut)
async def add_fridge_item(
    name: str = Form(...),
    description: str = Form(""),
    date_added: str = Form(...),
    quantity: int = Form(1),
    expiration_date: Optional[str] = Form(None),
    image: Optional[UploadFile] = File(None),
    image_url: Optional[str] = Form(None),
    db: Session = Depends(database.get_db),
):
    image_path = None
    if image and image.filename:
        image_path = save_image(image)
    elif image_url:
        image_path = download_image(image_url)

    try:
        parsed_date = datetime.fromisoformat(date_added)
    except ValueError:
        parsed_date = datetime.now(timezone.utc)

    parsed_exp = None
    if expiration_date:
        try:
            parsed_exp = datetime.strptime(expiration_date, "%Y-%m-%d").date()
        except ValueError:
            pass

    item = models.FridgeItem(
        name=name,
        description=description,
        date_added=parsed_date,
        image_path=image_path,
        quantity=max(1, quantity),
        expiration_date=parsed_exp,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@app.delete("/api/fridge/{item_id}")
def remove_fridge_item(item_id: int, db: Session = Depends(database.get_db)):
    item = db.query(models.FridgeItem).filter(models.FridgeItem.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    if item.quantity > 1:
        item.quantity -= 1
        db.commit()
        return {"ok": True, "quantity": item.quantity}
    item.active = False
    db.commit()
    return {"ok": True, "quantity": 0}


@app.patch("/api/fridge/{item_id}", response_model=FridgeItemOut)
async def update_fridge_item(
    item_id: int,
    name: Optional[str] = Form(None),
    description: Optional[str] = Form(None),
    date_added: Optional[str] = Form(None),
    quantity: Optional[int] = Form(None),
    expiration_date: Optional[str] = Form(None),
    image: Optional[UploadFile] = File(None),
    db: Session = Depends(database.get_db),
):
    item = db.query(models.FridgeItem).filter(models.FridgeItem.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    if name is not None:
        item.name = name
    if description is not None:
        item.description = description
    if date_added is not None:
        try:
            item.date_added = datetime.fromisoformat(date_added)
        except ValueError:
            pass
    if quantity is not None:
        item.quantity = max(1, quantity)
    if expiration_date is not None:
        item.expiration_date = (
            datetime.strptime(expiration_date, "%Y-%m-%d").date()
            if expiration_date else None
        )
    if image and image.filename:
        item.image_path = save_image(image)
    db.commit()
    db.refresh(item)
    return item


@app.post("/api/fridge/{item_id}/save-to-library", response_model=SavedFoodOut)
def save_item_to_library(item_id: int, db: Session = Depends(database.get_db)):
    item = db.query(models.FridgeItem).filter(models.FridgeItem.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    existing = (
        db.query(models.SavedFood)
        .filter(models.SavedFood.name.ilike(item.name))
        .first()
    )
    if existing:
        return existing
    saved = models.SavedFood(
        name=item.name,
        description=item.description,
        default_image_path=item.image_path,
    )
    db.add(saved)
    db.commit()
    db.refresh(saved)
    return saved


# --- Library endpoints ---

@app.get("/api/library", response_model=list[SavedFoodOut])
def list_library(db: Session = Depends(database.get_db)):
    return (
        db.query(models.SavedFood)
        .order_by(models.SavedFood.name)
        .all()
    )


@app.post("/api/library", response_model=SavedFoodOut)
async def create_saved_food(
    name: str = Form(...),
    description: str = Form(""),
    image: Optional[UploadFile] = File(None),
    db: Session = Depends(database.get_db),
):
    image_path = None
    if image and image.filename:
        image_path = save_image(image)

    saved = models.SavedFood(name=name, description=description, default_image_path=image_path)
    db.add(saved)
    db.commit()
    db.refresh(saved)
    return saved


@app.delete("/api/library/{saved_id}")
def delete_saved_food(saved_id: int, db: Session = Depends(database.get_db)):
    saved = db.query(models.SavedFood).filter(models.SavedFood.id == saved_id).first()
    if not saved:
        raise HTTPException(status_code=404, detail="Saved food not found")
    db.delete(saved)
    db.commit()
    return {"ok": True}


@app.patch("/api/library/{saved_id}", response_model=SavedFoodOut)
async def update_saved_food(
    saved_id: int,
    name: Optional[str] = Form(None),
    description: Optional[str] = Form(None),
    image: Optional[UploadFile] = File(None),
    db: Session = Depends(database.get_db),
):
    saved = db.query(models.SavedFood).filter(models.SavedFood.id == saved_id).first()
    if not saved:
        raise HTTPException(status_code=404, detail="Saved food not found")
    if name is not None:
        saved.name = name
    if description is not None:
        saved.description = description
    if image and image.filename:
        saved.default_image_path = save_image(image)
    db.commit()
    db.refresh(saved)
    return saved


@app.post("/api/library/{saved_id}/add-to-fridge", response_model=FridgeItemOut)
def add_from_library(saved_id: int, request: AddToFridgeRequest, db: Session = Depends(database.get_db)):
    saved = db.query(models.SavedFood).filter(models.SavedFood.id == saved_id).first()
    if not saved:
        raise HTTPException(status_code=404, detail="Saved food not found")

    parsed_exp = None
    if request.expiration_date:
        try:
            parsed_exp = datetime.strptime(request.expiration_date, "%Y-%m-%d").date()
        except ValueError:
            pass

    # Match on saved_food_id AND expiration_date — different expirations are separate entries
    q = db.query(models.FridgeItem).filter(
        models.FridgeItem.saved_food_id == saved_id,
        models.FridgeItem.active == True,
    )
    existing = (
        q.filter(models.FridgeItem.expiration_date == None).first()
        if parsed_exp is None
        else q.filter(models.FridgeItem.expiration_date == parsed_exp).first()
    )

    if existing:
        existing.quantity += 1
        db.commit()
        db.refresh(existing)
        return existing

    item = models.FridgeItem(
        saved_food_id=saved.id,
        name=saved.name,
        description=saved.description,
        date_added=datetime.now(timezone.utc),
        image_path=saved.default_image_path,
        expiration_date=parsed_exp,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


# --- Image suggestion ---

@app.get("/api/suggest-cache")
def get_suggestion_cache():
    return suggestion_cache


@app.get("/api/suggest-image")
def suggest_image(q: str):
    cache_key = q.lower().strip()
    if cache_key in suggestion_cache:
        return {"image_url": suggestion_cache[cache_key]}

    if not SPOONACULAR_API_KEY:
        raise HTTPException(status_code=503, detail="Image suggestions not configured")
    try:
        url = (
            "https://api.spoonacular.com/food/ingredients/search"
            f"?query={urllib.parse.quote(q)}&number=1"
        )
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0", "x-api-key": SPOONACULAR_API_KEY})
        with urllib.request.urlopen(req, timeout=8) as resp:
            data = json.loads(resp.read())
        results = data.get("results", [])
        if not results or not results[0].get("image"):
            raise HTTPException(status_code=404, detail="No image found")
        cdn_url = f"https://spoonacular.com/cdn/ingredients_500x500/{results[0]['image']}"
        suggestion_cache[cache_key] = cdn_url
        _save_suggestion_cache(suggestion_cache)
        return {"image_url": cdn_url}
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=404, detail="No image found")


# --- Static files (last so API routes take priority) ---

app.mount("/uploads", StaticFiles(directory="/data/uploads"), name="uploads")
app.mount("/", StaticFiles(directory="/app/frontend", html=True), name="frontend")
