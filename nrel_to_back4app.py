import requests
import pandas as pd
import time
import os
import math
from datetime import datetime

# --------------------------------------------------
# OUTPUT DIRECTORY
# --------------------------------------------------

CSV_OUTPUT_DIR = r"C:\Users\jessi\AppData\Local\Programs\Python\Python311\Scripts\Alternate  gas\csvtables"
os.makedirs(CSV_OUTPUT_DIR, exist_ok=True)

# --------------------------------------------------
# BACK4APP CONFIG
# --------------------------------------------------

APPLICATION_ID = "gbW0BkveFDrQJxbgGLqka2HeITel0qsXob9iFwI8"
REST_API_KEY = "bmR4ZTrDsW30Cy3lGj4QzKmt3QkBMm2C1OptnPuv"

BASE_URL = "https://parseapi.back4app.com/classes/EVStations"

headers = {
    "X-Parse-Application-Id": APPLICATION_ID,
    "X-Parse-REST-API-Key": REST_API_KEY,
    "Content-Type": "application/json"
}

headers_get = {
    "X-Parse-Application-Id": APPLICATION_ID,
    "X-Parse-REST-API-Key": REST_API_KEY
}

# --------------------------------------------------
# API CONFIG
# --------------------------------------------------

API_URL = "https://developer.nlr.gov/api/alt-fuel-stations/v1.json"
API_KEY = "nZytlFWbvdrFF2ZMZGZceMHuKPDKKpsR77flXk2i"

# --------------------------------------------------
# STEP 1 — DELETE EVERYTHING IN BACK4APP
# --------------------------------------------------

def clear_back4app_class():
    print("\n===================================")
    print("DELETING ALL EXISTING BACK4APP DATA")
    print("===================================\n")

    total_deleted = 0

    while True:
        r = requests.get(
            BASE_URL,
            headers=headers_get,
            params={"limit": 1000}
        )

        results = r.json().get("results", [])

        if not results:
            break

        for obj in results:
            object_id = obj.get("objectId")
            if not object_id:
                continue

            del_url = f"{BASE_URL}/{object_id}"
            d = requests.delete(del_url, headers=headers_get)

            if d.status_code in (200, 204):
                total_deleted += 1

        print(f"Deleted batch: {len(results)}")
        time.sleep(0.2)

    print("\nTOTAL DELETED:", total_deleted)

# --------------------------------------------------
# CLEAN FUNCTION
# --------------------------------------------------

def clean(value):
    if value is None:
        return None

    try:
        if pd.isna(value):
            return None
    except:
        pass

    if isinstance(value, float):
        if math.isnan(value):
            return None
        if value.is_integer():
            return int(value)

    if isinstance(value, list):
        return ", ".join(str(v) for v in value)

    if isinstance(value, dict):
        return str(value)

    return value

# --------------------------------------------------
# STEP 2 — DOWNLOAD DATA
# --------------------------------------------------

print("\nDOWNLOADING DATA...\n")

response = requests.get(
    API_URL,
    params={"fuel_type": "ELEC", "api_key": API_KEY},
    timeout=60
)

response.raise_for_status()

stations = response.json().get("fuel_stations", [])

print("Downloaded:", len(stations))

# --------------------------------------------------
# STEP 3 — BUILD DATAFRAME
# --------------------------------------------------

df = pd.DataFrame(stations)

if "id" in df.columns:
    df["station_id"] = df["id"]

# --------------------------------------------------
# STEP 4 — FILTER
# --------------------------------------------------

df["ev_dc_fast_num"] = pd.to_numeric(df.get("ev_dc_fast_num"), errors="coerce").fillna(0)
df["access_code"] = df.get("access_code", "").fillna("").astype(str)

filtered = df[
    (df["ev_dc_fast_num"] > 0) &
    (df["access_code"].str.lower() == "public")
].copy()

print("Filtered:", len(filtered))

# --------------------------------------------------
# STEP 5 — KEEP FIELDS
# --------------------------------------------------

keep_fields = [
    "station_id",
    "station_name",
    "street_address",
    "city",
    "state",
    "zip",
    "country",
    "latitude",
    "longitude",
    "fuel_type_code",
    "access_code",
    "status_code",
    "ev_network",
    "ev_dc_fast_num",
    "ev_level2_evse_num",
    "ev_level1_evse_num",
    "ev_connector_types",
    "ev_pricing",
    "station_phone",
    "facility_type",
    "open_date",
    "date_last_confirmed"
]

filtered = filtered[[c for c in keep_fields if c in filtered.columns]].copy()

# --------------------------------------------------
# STEP 6 — DELETE OLD DATA FIRST
# --------------------------------------------------

clear_back4app_class()

# --------------------------------------------------
# STEP 7 — UPLOAD NEW DATA
# --------------------------------------------------

print("\n===================================")
print("UPLOADING NEW DATA")
print("===================================\n")

success = 0
failed = 0

for i, row in filtered.iterrows():

    payload = {col: clean(row[col]) for col in filtered.columns}

    try:
        r = requests.post(BASE_URL, headers=headers, json=payload, timeout=30)

        if r.status_code in (200, 201):
            success += 1
        else:
            failed += 1
            print("FAILED:", r.text)

    except Exception as e:
        failed += 1
        print("ERROR:", e)

    time.sleep(0.05)

print("\nDONE")
print("Success:", success)
print("Failed:", failed)
