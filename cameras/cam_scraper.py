import requests
import json
import os
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

BASE_URL = "https://opencctv.org/api/cameras/list"
OUTPUT_FILE = "earth-app/cameras/cameras.json"
PROGRESS_FILE = "earth-app/cameras/progress.json"

PARAMS = {
    "limit": 50,
    "status": "active",
    "sortBy": "name",
    "sortDir": "asc"
}

HEADERS = {
    "accept": "application/json",
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
}

MAX_THREADS = 10
MAX_RETRIES = 6
BACKOFF_FACTOR = 1.5


# Load existing data
if os.path.exists(OUTPUT_FILE):
    with open(OUTPUT_FILE, "r") as f:
        all_data = json.load(f)
else:
    all_data = []

seen_ids = set(cam["id"] for cam in all_data)


def fetch_page(page):
    params = PARAMS.copy()
    params["page"] = page

    for attempt in range(1, MAX_RETRIES + 1):
        try:
            response = requests.get(
                BASE_URL,
                headers=HEADERS,
                params=params,
                timeout=30
            )
            response.raise_for_status()

            data = response.json()
            return page, data

        except requests.exceptions.RequestException as e:
            if attempt < MAX_RETRIES:
                wait = BACKOFF_FACTOR * attempt
                print(f"Retry {attempt}/{MAX_RETRIES} for page {page} in {wait:.1f}s ({e})")
                time.sleep(wait)
            else:
                print(f"Failed page {page} after {MAX_RETRIES} attempts: {e}")
                return page, None


def load_progress():
    if not os.path.exists(PROGRESS_FILE):
        return 0

    try:
        with open(PROGRESS_FILE, "r") as f:
            payload = json.load(f)
    except (OSError, json.JSONDecodeError):
        return 0

    return max(0, int(payload.get("last_page", 0) or 0))


def save_progress(last_page):
    with open(PROGRESS_FILE, "w") as f:
        json.dump({"last_page": last_page}, f)


def save_data():
    with open(OUTPUT_FILE, "w") as f:
        json.dump(all_data, f, indent=2)


def advance_contiguous_progress(last_page, completed_pages):
    while (last_page + 1) in completed_pages:
        last_page += 1

    return last_page


last_completed_page = load_progress()
start_page = max(1, last_completed_page + 1)

# Step 1: Get total pages
print("Fetching first page to determine total...")
first_page_data = fetch_page(1)[1]

if first_page_data is None:
    raise Exception("Failed to fetch first page")

total = first_page_data["total"]
limit = PARAMS["limit"]

# FIXED calculation
total_pages = (total + limit - 1) // limit

print(f"Total cameras: {total}")
print(f"Total pages: {total_pages}")

if start_page > total_pages:
    print(f"Progress already at page {last_completed_page}. Nothing left to scrape.")
    raise SystemExit(0)

if start_page > 1:
    print(f"Resuming from page {start_page} based on progress.json")

completed_pages = set()
contiguous_completed_page = last_completed_page

# Add first page immediately only on a fresh run
if start_page == 1:
    for cam in first_page_data["cameras"]:
        if cam["id"] not in seen_ids:
            all_data.append(cam)
            seen_ids.add(cam["id"])

    completed_pages.add(1)
    contiguous_completed_page = 1
    save_data()
    save_progress(contiguous_completed_page)

# Step 2: Fetch remaining pages in parallel
pages = list(range(max(2, start_page), total_pages + 1))

failed_pages = []

with ThreadPoolExecutor(max_workers=MAX_THREADS) as executor:
    futures = {executor.submit(fetch_page, p): p for p in pages}

    completed = len(completed_pages)

    for future in as_completed(futures):
        page = futures[future]
        _, data = future.result()

        if data is None:
            failed_pages.append(page)
            continue

        cameras = data.get("cameras", [])

        new_count = 0
        for cam in cameras:
            if cam["id"] not in seen_ids:
                all_data.append(cam)
                seen_ids.add(cam["id"])
                new_count += 1

        completed_pages.add(page)
        contiguous_completed_page = advance_contiguous_progress(
            contiguous_completed_page,
            completed_pages,
        )
        completed += 1

        print(f"Page {page} done | +{new_count} cams | total: {len(all_data)}")

        # Save every 5 pages
        if completed % 5 == 0:
            save_data()
            save_progress(contiguous_completed_page)


# Step 3: Retry failed pages (sequential for stability)
if failed_pages:
    print(f"\nRetrying {len(failed_pages)} failed pages...")

    for page in failed_pages:
        _, data = fetch_page(page)

        if data is None:
            print(f"Still failed: page {page}")
            continue

        cameras = data.get("cameras", [])

        new_count = 0
        for cam in cameras:
            if cam["id"] not in seen_ids:
                all_data.append(cam)
                seen_ids.add(cam["id"])
                new_count += 1

        completed_pages.add(page)
        contiguous_completed_page = advance_contiguous_progress(
            contiguous_completed_page,
            completed_pages,
        )
        print(f"Recovered page {page} | +{new_count} cams | total: {len(all_data)}")

    save_data()


# Final save
save_data()
save_progress(contiguous_completed_page)

if contiguous_completed_page >= total_pages:
    print("Scraping complete.")
else:
    print(f"Scraping paused at page {contiguous_completed_page}. Resume to continue.")
