#!/usr/bin/env python3
"""Download a small, attributed 10-image tree-species starter dataset.

Each image is fetched from Wikimedia Commons and must expose a reusable
license in its file metadata. The script saves the source page, creator,
license, and attribution text in manifest.csv.
"""

from __future__ import annotations

import csv
import re
import sys
import time
from pathlib import Path
from urllib.parse import urlparse

import requests

API = "https://commons.wikimedia.org/w/api.php"
OUT = Path(__file__).resolve().parent / "images"
USER_AGENT = "TreeSpeciesOpenCVStarter/1.0 (educational hackathon dataset)"

SPECIES = [
    ("oak", "oak tree"),
    ("maple", "maple tree"),
    ("pine", "pine tree"),
    ("palm", "palm tree"),
    ("birch", "birch tree"),
    ("willow", "willow tree"),
    ("cherry_blossom", "cherry blossom tree"),
    ("redwood", "coast redwood tree"),
    ("baobab", "baobab tree"),
    ("eucalyptus", "eucalyptus tree"),
]

ALLOWED_LICENSES = re.compile(r"public domain|CC0|CC BY(?:-SA)?(?:\s|$)", re.I)
SESSION = requests.Session()
SESSION.headers.update({"User-Agent": USER_AGENT})


def strip_html(value: str) -> str:
    return re.sub(r"<[^>]*>", " ", value or "").replace("&nbsp;", " ").strip()


def find_image(query: str) -> dict:
    search = SESSION.get(
        API,
        params={
            "action": "query",
            "format": "json",
            "generator": "search",
            "gsrsearch": f'filetype:bitmap "{query}"',
            "gsrnamespace": 6,
            "gsrlimit": 30,
            "prop": "imageinfo",
            "iiprop": "url|extmetadata",
            "iiurlwidth": 1000,
        },
        timeout=30,
    )
    search.raise_for_status()
    pages = search.json().get("query", {}).get("pages", {}).values()

    for page in pages:
        info = (page.get("imageinfo") or [{}])[0]
        meta = info.get("extmetadata", {})
        license_name = strip_html(meta.get("LicenseShortName", {}).get("value", ""))
        if not ALLOWED_LICENSES.search(license_name):
            continue
        image_url = info.get("thumburl") or info.get("url")
        if not image_url:
            continue
        return {
            "title": page.get("title", ""),
            "image_url": image_url,
            "source_page": info.get("descriptionurl", ""),
            "creator": strip_html(meta.get("Artist", {}).get("value", "")),
            "license": license_name,
            "license_url": meta.get("LicenseUrl", {}).get("value", ""),
            "credit": strip_html(meta.get("Credit", {}).get("value", "")),
        }
    raise RuntimeError(f'No image with an accepted reusable license found for "{query}".')


def download_one(label: str, query: str) -> dict:
    info = find_image(query)
    response = SESSION.get(info["image_url"], timeout=60)
    response.raise_for_status()
    suffix = Path(urlparse(info["image_url"]).path).suffix.lower()
    if suffix not in {".jpg", ".jpeg", ".png", ".webp"}:
        content_type = response.headers.get("content-type", "").lower()
        suffix = ".png" if "png" in content_type else ".jpg"
    filename = f"{label}{suffix}"
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / filename).write_bytes(response.content)
    return {
        "label": label,
        "filename": filename,
        "commons_title": info["title"],
        "source_page": info["source_page"],
        "creator": info["creator"],
        "license": info["license"],
        "license_url": info["license_url"],
        "credit": info["credit"],
    }


def main() -> int:
    rows = []
    failures = []
    for label, query in SPECIES:
        try:
            row = download_one(label, query)
            rows.append(row)
            print(f"Downloaded {row['filename']} ({row['license']})")
        except Exception as error:  # Keep downloading other labels if a search fails.
            failures.append((label, str(error)))
            print(f"Could not download {label}: {error}", file=sys.stderr)
        time.sleep(0.15)

    manifest = OUT / "manifest.csv"
    fields = [
        "label", "filename", "commons_title", "source_page", "creator",
        "license", "license_url", "credit",
    ]
    with manifest.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)

    if failures:
        print(f"\nDownloaded {len(rows)}/10 images. See errors above and rerun to retry.", file=sys.stderr)
        return 1
    print(f"\nDataset ready: {OUT}\nAttribution manifest: {manifest}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
