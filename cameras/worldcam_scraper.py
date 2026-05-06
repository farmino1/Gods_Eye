from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import html
import json
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable
from urllib.parse import urljoin, urlparse

import requests

BASE_URL = "https://worldcam.eu"
SECTION_URLS = [
    f"{BASE_URL}/webcams/africa",
    f"{BASE_URL}/webcams/north-america",
    f"{BASE_URL}/webcams/south-america",
    f"{BASE_URL}/webcams/australia-oceania",
    f"{BASE_URL}/webcams/asia",
    f"{BASE_URL}/webcams/poles",
    f"{BASE_URL}/webcams/europe",
    f"{BASE_URL}/webcams/poland",
]
SCRIPT_DIR = Path(__file__).resolve().parent
OUTPUT_FILE = SCRIPT_DIR / "cameras.json"
PROGRESS_FILE = SCRIPT_DIR / "worldcam_progress.json"
REQUEST_TIMEOUT_SECONDS = 30
MAX_RETRIES = 5
BACKOFF_FACTOR_SECONDS = 2
MAX_THREADS = 10
REDIRECT_STATUS_CODES = {301, 302, 303, 307, 308}
IMAGE_PATH_SUFFIXES = (
    ".jpg",
    ".jpeg",
    ".png",
    ".gif",
    ".webp",
    ".bmp",
    ".avif",
)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/135.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "en-US,en;q=0.9",
}

LISTING_ROW_RE = re.compile(r"<tr\b[^>]*>(.*?)</tr>", re.IGNORECASE | re.DOTALL)
LISTING_TITLE_RE = re.compile(
    r'<a class="webcams-list-title" href="([^"]+)">(.+?)</a>',
    re.IGNORECASE | re.DOTALL,
)
LISTING_PREVIEW_RE = re.compile(r'data-src="([^"]+)"', re.IGNORECASE)
LISTING_PAGES_RE = re.compile(r'href="[^"]+/p/(\d+)"', re.IGNORECASE)
REGION_LINK_RE = re.compile(r'href="([^"]+)"', re.IGNORECASE)
DETAIL_TITLE_RE = re.compile(
    r'<h1 class="webcam-title">(.+?)</h1>',
    re.IGNORECASE | re.DOTALL,
)
PAGE_TITLE_RE = re.compile(r"<title>(.+?)</title>", re.IGNORECASE | re.DOTALL)
DETAIL_DESCRIPTION_RE = re.compile(
    r'<div class="col-desc webcam-description">(.+?)</div>',
    re.IGNORECASE | re.DOTALL,
)
DETAIL_PROVIDER_BLOCK_RE = re.compile(
    r'<div class="col-head">Provider website</div>\s*<div class="col-desc[^"]*">(.+?)</div>',
    re.IGNORECASE | re.DOTALL,
)
DETAIL_HREF_RE = re.compile(r'href="([^"]+)"', re.IGNORECASE)
DETAIL_OG_IMAGE_RE = re.compile(
    r'<meta property="og:image" content="([^"]+)"',
    re.IGNORECASE,
)
DETAIL_OG_LAT_RE = re.compile(
    r'<meta property="og:latitude" content="([^"]+)"',
    re.IGNORECASE,
)
DETAIL_OG_LON_RE = re.compile(
    r'<meta property="og:longitude" content="([^"]+)"',
    re.IGNORECASE,
)
DETAIL_LIVEVIEW_RE = re.compile(
    r'href="(https://worldcam\.eu/liveview/\d+)"',
    re.IGNORECASE,
)
DETAIL_BREADCRUMB_RE = re.compile(
    r'<span itemprop="name">(.+?)</span>',
    re.IGNORECASE | re.DOTALL,
)
DETAIL_CAMERA_ID_RE = re.compile(r"/(\d+)(?:-[^/?#]+)?$")
URL_IN_TEXT_RE = re.compile(r"https?://[^\s\"'<>]+", re.IGNORECASE)


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace(
        "+00:00",
        "Z",
    )


def collapse_whitespace(value: str) -> str:
    return re.sub(r"\s+", " ", value or "").strip()


def strip_tags(value: str) -> str:
    return re.sub(r"<[^>]+>", " ", value or "")


def clean_text(value: str | None) -> str:
    return collapse_whitespace(html.unescape(strip_tags(value or "")))


def to_float(value: str | None, fallback: float | None = None) -> float | None:
    try:
        return float(str(value).strip())
    except (TypeError, ValueError):
        return fallback


def to_int(value: str | None, fallback: int | None = None) -> int | None:
    try:
        return int(str(value).replace(" ", "").strip())
    except (TypeError, ValueError):
        return fallback


def slugify(value: str) -> str:
    normalized = re.sub(r"[^a-z0-9]+", "-", value.lower())
    return normalized.strip("-")


def canonicalize_url(value: str | None, *, preserve_query: bool = False) -> str:
    normalized_value = str(value or "").strip()
    if not normalized_value:
        return ""

    parsed_url = urlparse(normalized_value)
    path = re.sub(r"/+", "/", parsed_url.path or "").rstrip("/")
    canonical_url = parsed_url._replace(
        scheme=parsed_url.scheme.lower(),
        netloc=parsed_url.netloc.lower(),
        path=path,
        params="",
        query=parsed_url.query if preserve_query else "",
        fragment="",
    )

    return canonical_url.geturl()


def round_coordinate(value: float | int | str | None) -> str:
    numeric_value = to_float(str(value) if value is not None else None)
    return f"{numeric_value:.5f}" if numeric_value is not None else ""


def build_name_coordinate_signature(
    name: str | None,
    lat: float | int | str | None,
    lon: float | int | str | None,
) -> str:
    normalized_name = slugify(str(name or "").strip())
    rounded_lat = round_coordinate(lat)
    rounded_lon = round_coordinate(lon)

    if not normalized_name or not rounded_lat or not rounded_lon:
        return ""

    return f"{normalized_name}|{rounded_lat}|{rounded_lon}"


def build_detail_slug_signature(value: str | None) -> str:
    normalized_value = slugify(str(value or "").strip())
    return normalized_value


def iter_worldcam_related_urls(*values: str | None) -> Iterable[str]:
    for value in values:
        canonical_value = canonicalize_url(value)
        if canonical_value:
            yield canonical_value

        for match in URL_IN_TEXT_RE.findall(str(value or "")):
            canonical_match = canonicalize_url(match)
            if canonical_match:
                yield canonical_match


def parse_location_label(value: str) -> tuple[str, str]:
    cleaned_value = collapse_whitespace(value)

    if not cleaned_value:
        return "", ""

    match = re.match(r"(.+?)\s*\(([^()]+)\)$", cleaned_value)
    if match:
        return collapse_whitespace(match.group(1)), collapse_whitespace(match.group(2))

    return "", cleaned_value


def parse_camera_code_from_url(url: str) -> int | None:
    match = DETAIL_CAMERA_ID_RE.search(urlparse(url).path)
    return to_int(match.group(1) if match else None)


def build_worldcam_liveview_url(camera_code: int | None) -> str:
    if camera_code is None:
        return ""

    return f"{BASE_URL}/liveview/{camera_code}"


def infer_category(title: str, description: str) -> str:
    haystack = f"{title} {description}".lower()

    if any(
        keyword in haystack
        for keyword in (
            "traffic",
            "motorway",
            "highway",
            "road",
            "runway",
            "airport",
            "station",
            "bridge",
        )
    ):
        return "traffic"

    if any(
        keyword in haystack
        for keyword in (
            "eagle",
            "owl",
            "falcon",
            "stork",
            "bird",
            "nest",
            "animal",
            "wildlife",
        )
    ):
        return "wildlife"

    if any(
        keyword in haystack
        for keyword in (
            "beach",
            "sea",
            "harbour",
            "harbor",
            "port",
            "marina",
            "lake",
            "river",
            "bay",
        )
    ):
        return "scenic"

    if any(
        keyword in haystack
        for keyword in (
            "ski",
            "snow",
            "mountain",
            "slope",
            "resort",
        )
    ):
        return "mountain"

    return "scenic"


def load_json(path: Path, fallback):
    if not path.exists():
        return fallback

    with path.open("r", encoding="utf-8") as file_handle:
        return json.load(file_handle)


def save_json(path: Path, payload) -> None:
    with path.open("w", encoding="utf-8") as file_handle:
        json.dump(payload, file_handle, indent=2, ensure_ascii=False)


def create_http_session() -> requests.Session:
    session = requests.Session()
    session.headers.update(HEADERS)
    return session


def request_with_retries(
    session: requests.Session | None,
    url: str,
    *,
    allow_redirects: bool = True,
    stream: bool = False,
) -> requests.Response:
    last_error = None
    http_client = session or requests

    for attempt in range(1, MAX_RETRIES + 1):
        try:
            response = http_client.get(
                url,
                timeout=REQUEST_TIMEOUT_SECONDS,
                headers=HEADERS,
                allow_redirects=allow_redirects,
                stream=stream,
            )
            response.raise_for_status()
            return response
        except requests.RequestException as error:
            last_error = error
            if attempt >= MAX_RETRIES:
                break

            wait_seconds = BACKOFF_FACTOR_SECONDS * attempt
            print(
                f"Retry {attempt}/{MAX_RETRIES} for {url} in {wait_seconds:.1f}s ({error})",
            )
            time.sleep(wait_seconds)

    raise RuntimeError(f"Unable to fetch {url}: {last_error}") from last_error


def fetch_text(session: requests.Session | None, url: str) -> str:
    response = request_with_retries(session, url)
    try:
        return response.text
    finally:
        response.close()


def is_worldcam_click_url(url: str | None) -> bool:
    canonical_url = canonicalize_url(url, preserve_query=True)
    if not canonical_url:
        return False

    parsed_url = urlparse(canonical_url)
    return parsed_url.netloc in {"worldcam.eu", "www.worldcam.eu"} and parsed_url.path.startswith(
        "/click/",
    )


def normalize_worldcam_click_url(url: str | None) -> str:
    canonical_url = canonicalize_url(url, preserve_query=True)
    if not canonical_url:
        return ""

    parsed_url = urlparse(canonical_url)
    if parsed_url.netloc not in {"worldcam.eu", "www.worldcam.eu"}:
        return canonical_url

    normalized_path = parsed_url.path
    if normalized_path == "/click/source":
        normalized_path = "/click/url"

    return parsed_url._replace(
        scheme="https",
        netloc="worldcam.eu",
        path=normalized_path,
    ).geturl()


def resolve_worldcam_redirect_url(
    session: requests.Session | None,
    url: str | None,
    *,
    max_hops: int = 5,
) -> str:
    current_url = normalize_worldcam_click_url(url)
    if not current_url:
        return ""

    if not is_worldcam_click_url(current_url):
        return current_url

    for _ in range(max_hops):
        response = request_with_retries(
            session,
            current_url,
            allow_redirects=False,
            stream=True,
        )
        try:
            redirect_url = urljoin(current_url, response.headers.get("location", ""))
        finally:
            response.close()

        canonical_redirect_url = canonicalize_url(redirect_url, preserve_query=True)
        if response.status_code not in REDIRECT_STATUS_CODES or not canonical_redirect_url:
            return ""

        if not is_worldcam_click_url(canonical_redirect_url):
            return canonical_redirect_url

        current_url = normalize_worldcam_click_url(canonical_redirect_url)

    return ""


def infer_feed_type(feed_url: str, feed_kind: str) -> tuple[str, int]:
    parsed_url = urlparse(feed_url)
    normalized_path = (parsed_url.path or "").lower()

    if normalized_path.endswith(IMAGE_PATH_SUFFIXES):
        return "image", 30_000

    return "iframe", 0


def fetch_listing_detail(index: int, listing: dict) -> tuple[int, dict, dict | None, str | None]:
    try:
        with create_http_session() as session:
            detail_html = fetch_text(session, listing["detail_url"])
            detail = parse_detail_page(detail_html, listing["detail_url"])
            if not detail:
                return index, listing, None, "detail parsing returned no camera data"

            detail["provider_url"] = canonicalize_url(
                detail.get("provider_url"),
                preserve_query=True,
            )
            detail["resolved_provider_url"] = resolve_worldcam_redirect_url(
                session,
                detail.get("provider_url"),
            )

            return index, listing, detail, None
    except Exception as error:  # pragma: no cover - network/runtime branch
        return index, listing, None, str(error)


def resolve_section_page_url(section_url: str, page_number: int) -> str:
    if page_number <= 1:
        return section_url

    return f"{section_url.rstrip('/')}/p/{page_number}"


def parse_max_page_count(section_html: str) -> int:
    page_numbers = [int(match) for match in LISTING_PAGES_RE.findall(section_html)]
    return max(page_numbers, default=1)


def is_camera_detail_url(url: str) -> bool:
    path_parts = [part for part in urlparse(url).path.split("/") if part]
    if not path_parts:
        return False

    return bool(re.match(r"^\d+-", path_parts[-1]))


def is_pagination_url(url: str) -> bool:
    return bool(re.search(r"/p/\d+/?$", urlparse(url).path))


def is_valid_region_url(candidate_url: str, section_url: str) -> bool:
    canonical_candidate_url = canonicalize_url(candidate_url)
    canonical_section_url = canonicalize_url(section_url)

    if not canonical_candidate_url:
        return False

    if canonical_candidate_url == canonical_section_url:
        return False

    if not canonical_candidate_url.startswith(f"{canonical_section_url}/"):
        return False

    if is_pagination_url(canonical_candidate_url):
        return False

    if is_camera_detail_url(canonical_candidate_url):
        return False

    return True


def parse_region_urls(section_html: str, section_url: str) -> list[str]:
    region_urls = []
    seen_urls = set()

    for href in REGION_LINK_RE.findall(section_html):
        candidate_url = canonicalize_url(urljoin(BASE_URL, html.unescape(href)))
        if not is_valid_region_url(candidate_url, section_url):
            continue

        if candidate_url in seen_urls:
            continue

        seen_urls.add(candidate_url)
        region_urls.append(candidate_url)

    return region_urls


def discover_region_urls(
    session: requests.Session,
    section_url: str,
) -> list[str]:
    discovered_urls = []
    seen_urls = {canonicalize_url(section_url)}
    pending_urls = [section_url]

    while pending_urls:
        current_url = pending_urls.pop(0)
        current_html = fetch_text(session, current_url)

        for region_url in parse_region_urls(current_html, section_url):
            canonical_region_url = canonicalize_url(region_url)
            if canonical_region_url in seen_urls:
                continue

            seen_urls.add(canonical_region_url)
            discovered_urls.append(region_url)
            pending_urls.append(region_url)

    return discovered_urls


def parse_listing_page(section_html: str, section_url: str) -> list[dict]:
    listings = []

    for row_html in LISTING_ROW_RE.findall(section_html):
        if "webcams-list-title" not in row_html:
            continue

        title_match = LISTING_TITLE_RE.search(row_html)
        if not title_match:
            continue

        detail_url = urljoin(BASE_URL, html.unescape(title_match.group(1)))
        title = clean_text(title_match.group(2))
        preview_match = LISTING_PREVIEW_RE.search(row_html)
        preview_image_url = (
            urljoin(BASE_URL, html.unescape(preview_match.group(1)))
            if preview_match
            else ""
        )
        view_count_match = re.search(
            r'title="visits:".*?([0-9][0-9 ]+)',
            row_html,
            re.IGNORECASE | re.DOTALL,
        )
        feed_kind = (
            "streaming"
            if "type-streaming" in row_html
            else "static"
            if "type-static" in row_html
            else "unknown"
        )

        listings.append(
            {
                "detail_url": detail_url,
                "title": title,
                "preview_image_url": preview_image_url,
                "feed_kind": feed_kind,
                "view_count": to_int(view_count_match.group(1) if view_count_match else None, 0),
                "section_url": section_url,
            },
        )

    return listings


def parse_detail_page(detail_html: str, detail_url: str) -> dict | None:
    title_match = DETAIL_TITLE_RE.search(detail_html)
    if not title_match:
        return None

    page_title_match = PAGE_TITLE_RE.search(detail_html)
    page_title = clean_text(page_title_match.group(1) if page_title_match else "")
    page_title = re.sub(r"\s*-\s*(?:Webcams|Live View)\s*$", "", page_title).strip()

    title = clean_text(title_match.group(1))
    if not title and page_title:
        title = page_title.split(",")[0].strip()

    description_match = DETAIL_DESCRIPTION_RE.search(detail_html)
    description = clean_text(description_match.group(1) if description_match else "")

    provider_block_match = DETAIL_PROVIDER_BLOCK_RE.search(detail_html)
    provider_url = ""
    if provider_block_match:
        provider_href_match = DETAIL_HREF_RE.search(provider_block_match.group(1))
        if provider_href_match:
            provider_url = urljoin(BASE_URL, html.unescape(provider_href_match.group(1)))

    preview_image_match = DETAIL_OG_IMAGE_RE.search(detail_html)
    preview_image_url = (
        html.unescape(preview_image_match.group(1))
        if preview_image_match
        else ""
    )
    liveview_match = DETAIL_LIVEVIEW_RE.search(detail_html)
    liveview_url = html.unescape(liveview_match.group(1)) if liveview_match else ""
    lat_match = DETAIL_OG_LAT_RE.search(detail_html)
    lon_match = DETAIL_OG_LON_RE.search(detail_html)
    lat = to_float(lat_match.group(1) if lat_match else None)
    lon = to_float(lon_match.group(1) if lon_match else None)
    breadcrumb_names = [
        clean_text(match)
        for match in DETAIL_BREADCRUMB_RE.findall(detail_html)
    ]
    location_breadcrumbs = breadcrumb_names[1:-1] if len(breadcrumb_names) > 1 else []

    state = ""
    country = ""

    if len(location_breadcrumbs) >= 2:
        country = location_breadcrumbs[0]
        state = ", ".join(location_breadcrumbs[1:])
    elif len(location_breadcrumbs) == 1:
        parsed_state, parsed_country = parse_location_label(location_breadcrumbs[0])
        state = parsed_state
        country = parsed_country

    if not country and ", " in page_title:
        _, page_title_location = page_title.rsplit(", ", 1)
        parsed_state, parsed_country = parse_location_label(page_title_location)
        state = state or parsed_state
        country = country or parsed_country

    city = title.split(" - ", 1)[0].strip() if title else ""

    camera_code = parse_camera_code_from_url(detail_url)
    detail_slug = Path(urlparse(detail_url).path).name

    return {
        "camera_code": camera_code,
        "name": title,
        "city": city,
        "state": state,
        "country": country,
        "lat": lat,
        "lng": lon,
        "preview_image_url": preview_image_url,
        "liveview_url": liveview_url,
        "provider_url": provider_url,
        "description": description,
        "detail_url": detail_url,
        "detail_slug": detail_slug,
    }


def build_camera_record(
    listing: dict,
    detail: dict,
    imported_at_iso: str,
) -> dict | None:
    camera_code = detail.get("camera_code")
    lat = detail.get("lat")
    lon = detail.get("lng")

    if camera_code is None or lat is None or lon is None:
        return None

    preview_image_url = detail.get("preview_image_url") or listing.get("preview_image_url") or ""
    liveview_url = detail.get("liveview_url") or build_worldcam_liveview_url(camera_code)
    provider_url = detail.get("provider_url") or ""
    resolved_provider_url = detail.get("resolved_provider_url") or ""
    feed_kind = listing.get("feed_kind") or "unknown"

    if resolved_provider_url:
        feed_url = resolved_provider_url
        feed_type, update_rate = infer_feed_type(feed_url, feed_kind)
    elif provider_url and not is_worldcam_click_url(provider_url):
        feed_url = provider_url
        feed_type, update_rate = infer_feed_type(feed_url, feed_kind)
    elif liveview_url:
        feed_url = liveview_url
        feed_type = "iframe"
        update_rate = 0
    elif preview_image_url:
        feed_url = preview_image_url
        feed_type = "image"
        update_rate = 30_000
    else:
        return None

    description_parts = [detail.get("description", "").strip()]

    if provider_url:
        description_parts.append(f"Provider website: {provider_url}")

    if resolved_provider_url and provider_url and resolved_provider_url != provider_url:
        description_parts.append(f"Resolved source: {resolved_provider_url}")

    if liveview_url and feed_url != liveview_url:
        description_parts.append(f"WorldCam live view: {liveview_url}")

    description = " ".join(part for part in description_parts if part).strip() or None
    camera_name = detail.get("name") or listing.get("title") or f"WorldCam {camera_code}"

    return {
        "id": f"worldcam-{camera_code}",
        "camera_code": camera_code,
        "name": camera_name,
        "city": detail.get("city") or None,
        "state": detail.get("state") or None,
        "country": detail.get("country") or "Unknown",
        "lat": lat,
        "lng": lon,
        "feed_url": feed_url,
        "feed_type": feed_type,
        "update_rate": update_rate,
        "source": "worldcam",
        "direction": None,
        "last_checked": imported_at_iso,
        "active": 1,
        "category": infer_category(camera_name, description or ""),
        "last_seen_by_source": imported_at_iso,
        "last_refresh_check": None,
        "deactivated_at": None,
        "duplicate_of": None,
        "consecutive_failures": 0,
        "traffic_slug": detail.get("detail_slug") or slugify(camera_name),
        "force_direct": 0,
        "description": description,
        "timezone": None,
        "last_image_hash": None,
        "image_hash_streak": 0,
        "ignored": 0,
        "feed_last_modified": None,
        "fingerprint_mode": "normal",
        "view_count": max(0, int(listing.get("view_count") or 0)),
        "share_count": 0,
    }


def build_existing_worldcam_keys(
    existing_cameras: Iterable[dict],
) -> tuple[set[str], set[int], set[str], set[str], set[str]]:
    seen_ids = set()
    seen_codes = set()
    seen_urls = set()
    seen_detail_slugs = set()
    seen_name_coordinate_signatures = set()

    for camera in existing_cameras:
        camera_id = str(camera.get("id") or "").strip()
        if camera_id:
            seen_ids.add(camera_id)

        for url_candidate in (
            camera.get("feed_url"),
            camera.get("description"),
        ):
            for canonical_url in iter_worldcam_related_urls(url_candidate):
                if not (
                    canonical_url.startswith("https://worldcam.eu/") or
                    canonical_url.startswith("https://www.worldcam.pl/images/webcams/")
                ):
                    continue
                seen_urls.add(canonical_url)

        detail_slug_signature = build_detail_slug_signature(camera.get("traffic_slug"))
        if detail_slug_signature and str(camera.get("source") or "").strip().lower() == "worldcam":
            seen_detail_slugs.add(detail_slug_signature)

        name_coordinate_signature = build_name_coordinate_signature(
            camera.get("name"),
            camera.get("lat"),
            camera.get("lng"),
        )
        if name_coordinate_signature and str(camera.get("source") or "").strip().lower() == "worldcam":
            seen_name_coordinate_signatures.add(name_coordinate_signature)

        if str(camera.get("source") or "").strip().lower() != "worldcam":
            continue

        try:
            seen_codes.add(int(camera.get("camera_code")))
        except (TypeError, ValueError):
            continue

    return (
        seen_ids,
        seen_codes,
        seen_urls,
        seen_detail_slugs,
        seen_name_coordinate_signatures,
    )


def is_duplicate_worldcam_camera(
    listing: dict,
    detail: dict,
    seen_ids: set[str],
    seen_codes: set[int],
    seen_urls: set[str],
    seen_detail_slugs: set[str],
    seen_name_coordinate_signatures: set[str],
) -> bool:
    camera_code = detail.get("camera_code")
    if camera_code in seen_codes:
        return True

    if f"worldcam-{camera_code}" in seen_ids:
        return True

    for url_candidate in (
        detail.get("detail_url"),
        detail.get("liveview_url"),
        detail.get("preview_image_url"),
        listing.get("detail_url"),
        listing.get("preview_image_url"),
    ):
        canonical_url = canonicalize_url(url_candidate)
        if canonical_url and canonical_url in seen_urls:
            return True

    detail_slug_signature = build_detail_slug_signature(detail.get("detail_slug"))
    if detail_slug_signature and detail_slug_signature in seen_detail_slugs:
        return True

    name_coordinate_signature = build_name_coordinate_signature(
        detail.get("name") or listing.get("title"),
        detail.get("lat"),
        detail.get("lng"),
    )
    if (
        name_coordinate_signature and
        name_coordinate_signature in seen_name_coordinate_signatures
    ):
        return True

    return False


def register_worldcam_camera_signatures(
    record: dict,
    detail: dict,
    listing: dict,
    seen_ids: set[str],
    seen_codes: set[int],
    seen_urls: set[str],
    seen_detail_slugs: set[str],
    seen_name_coordinate_signatures: set[str],
) -> None:
    seen_ids.add(record["id"])
    seen_codes.add(record["camera_code"])

    for url_candidate in (
        record.get("feed_url"),
        detail.get("detail_url"),
        detail.get("liveview_url"),
        detail.get("preview_image_url"),
        listing.get("detail_url"),
        listing.get("preview_image_url"),
    ):
        canonical_url = canonicalize_url(url_candidate)
        if canonical_url:
            seen_urls.add(canonical_url)

    detail_slug_signature = build_detail_slug_signature(
        detail.get("detail_slug") or record.get("traffic_slug"),
    )
    if detail_slug_signature:
        seen_detail_slugs.add(detail_slug_signature)

    name_coordinate_signature = build_name_coordinate_signature(
        record.get("name"),
        record.get("lat"),
        record.get("lng"),
    )
    if name_coordinate_signature:
        seen_name_coordinate_signatures.add(name_coordinate_signature)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Scrape worldcam.eu section pages and append new camera records "
            "to cameras.json using the repo's existing schema."
        ),
    )
    parser.add_argument(
        "--max-pages-per-section",
        type=int,
        default=0,
        help="Optional safety cap while testing. 0 means no cap.",
    )
    parser.add_argument(
        "--max-new-cameras",
        type=int,
        default=0,
        help="Optional limit for newly appended cameras. 0 means no cap.",
    )
    parser.add_argument(
        "--start-section",
        default="",
        help="Optional section URL suffix, for example 'europe' or 'north-america'.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    all_cameras = load_json(OUTPUT_FILE, [])
    progress = load_json(
        PROGRESS_FILE,
        {
            "section_url": "",
            "page_number": 1,
            "new_cameras_added": 0,
            "last_saved_at": None,
        },
    )
    (
        seen_ids,
        seen_worldcam_codes,
        seen_worldcam_urls,
        seen_worldcam_detail_slugs,
        seen_worldcam_name_coordinate_signatures,
    ) = build_existing_worldcam_keys(all_cameras)
    imported_at_iso = now_iso()
    new_cameras_added = 0

    section_urls = SECTION_URLS
    if args.start_section:
        normalized_suffix = args.start_section.strip().strip("/")
        section_urls = [
            url
            for url in SECTION_URLS
            if url.rstrip("/").endswith(normalized_suffix)
        ]
        if not section_urls:
            raise SystemExit(f"No WorldCam section matched '{args.start_section}'.")

    session = create_http_session()
    progress_section_url = canonicalize_url(progress.get("section_url"))

    for section_url in section_urls:
        region_urls = [section_url, *discover_region_urls(session, section_url)]
        print(f"Section {section_url} | discovered {len(region_urls)} region pages")

        canonical_section_url = canonicalize_url(section_url)
        resume_active = bool(progress_section_url) and progress_section_url.startswith(
            f"{canonical_section_url}/",
        )

        for region_url in region_urls:
            region_html = fetch_text(session, region_url)
            total_pages = parse_max_page_count(region_html)
            if args.max_pages_per_section > 0:
                total_pages = min(total_pages, args.max_pages_per_section)

            start_page = 1
            if progress_section_url == canonicalize_url(region_url):
                start_page = max(1, int(progress.get("page_number") or 1))
                resume_active = False
                progress_section_url = ""
            elif resume_active:
                continue

            print(
                f"Region {region_url} | pages: {total_pages} | starting at page {start_page}",
            )

            for page_number in range(start_page, total_pages + 1):
                page_url = resolve_section_page_url(region_url, page_number)
                print(f"Fetching list page {page_number}/{total_pages}: {page_url}")
                page_html = region_html if page_number == 1 else fetch_text(session, page_url)
                listings = parse_listing_page(page_html, section_url)
                print(f"Found {len(listings)} camera listings on page {page_number}")

                pending_detail_jobs = []
                for index, listing in enumerate(listings, start=1):
                    if args.max_new_cameras > 0 and new_cameras_added >= args.max_new_cameras:
                        save_json(OUTPUT_FILE, all_cameras)
                        progress.update(
                            {
                                "section_url": region_url,
                                "page_number": page_number,
                                "new_cameras_added": new_cameras_added,
                                "last_saved_at": now_iso(),
                            },
                        )
                        save_json(PROGRESS_FILE, progress)
                        print(f"Reached --max-new-cameras={args.max_new_cameras}.")
                        return

                    listing_camera_code = parse_camera_code_from_url(listing["detail_url"])
                    if listing_camera_code in seen_worldcam_codes:
                        continue

                    pending_detail_jobs.append((index, listing))

                detail_results = []
                failed_detail_jobs = []

                if pending_detail_jobs:
                    with ThreadPoolExecutor(max_workers=MAX_THREADS) as executor:
                        futures = {
                            executor.submit(fetch_listing_detail, index, listing): (index, listing)
                            for index, listing in pending_detail_jobs
                        }

                        for future in as_completed(futures):
                            index, listing = futures[future]

                            try:
                                next_index, next_listing, detail, error_message = future.result()
                            except Exception as error:  # pragma: no cover - executor/runtime branch
                                detail = None
                                error_message = str(error)
                                next_index = index
                                next_listing = listing

                            if not detail:
                                failed_detail_jobs.append((next_index, next_listing, error_message))
                                continue

                            detail_results.append((next_index, next_listing, detail))

                if failed_detail_jobs:
                    print(f"Retrying {len(failed_detail_jobs)} failed camera detail fetches...")

                    for index, listing, error_message in failed_detail_jobs:
                        if error_message:
                            print(f"  retrying {listing['detail_url']} ({error_message})")

                        try:
                            detail_html = fetch_text(session, listing["detail_url"])
                            detail = parse_detail_page(detail_html, listing["detail_url"])
                        except Exception as error:
                            print(f"Still failed: {listing['detail_url']} ({error})")
                            continue

                        if not detail:
                            print(f"Skipping listing without detail data: {listing['detail_url']}")
                            continue

                        detail["provider_url"] = canonicalize_url(
                            detail.get("provider_url"),
                            preserve_query=True,
                        )
                        detail["resolved_provider_url"] = resolve_worldcam_redirect_url(
                            session,
                            detail.get("provider_url"),
                        )
                        detail_results.append((index, listing, detail))

                for index, listing, detail in sorted(detail_results, key=lambda item: item[0]):
                    if is_duplicate_worldcam_camera(
                        listing,
                        detail,
                        seen_ids,
                        seen_worldcam_codes,
                        seen_worldcam_urls,
                        seen_worldcam_detail_slugs,
                        seen_worldcam_name_coordinate_signatures,
                    ):
                        continue

                    record = build_camera_record(listing, detail, imported_at_iso)
                    if not record:
                        print(f"Skipping incomplete WorldCam record: {listing['detail_url']}")
                        continue

                    all_cameras.append(record)
                    register_worldcam_camera_signatures(
                        record,
                        detail,
                        listing,
                        seen_ids,
                        seen_worldcam_codes,
                        seen_worldcam_urls,
                        seen_worldcam_detail_slugs,
                        seen_worldcam_name_coordinate_signatures,
                    )
                    new_cameras_added += 1

                    print(
                        f"  + [{new_cameras_added}] {record['id']} | {record['name']} "
                        f"({index}/{len(listings)} on page {page_number})",
                    )

                save_json(OUTPUT_FILE, all_cameras)
                progress.update(
                    {
                        "section_url": region_url,
                        "page_number": page_number + 1,
                        "new_cameras_added": new_cameras_added,
                        "last_saved_at": now_iso(),
                    },
                )
                save_json(PROGRESS_FILE, progress)

    progress.update(
        {
            "section_url": "",
            "page_number": 1,
            "new_cameras_added": new_cameras_added,
            "last_saved_at": now_iso(),
        },
    )
    save_json(PROGRESS_FILE, progress)
    save_json(OUTPUT_FILE, all_cameras)
    print(f"WorldCam scraping complete. Added {new_cameras_added} new cameras.")


if __name__ == "__main__":
    main()
