import requests
import pandas as pd

API_URL = "https://developer.nlr.gov/api/alt-fuel-stations/v1.json"
API_KEY = "nZytlFWbvdrFF2ZMZGZceMHuKPDKKpsR77flXk2i"

params = {
    "fuel_type": "ELEC",   # your working filter
    "api_key": API_KEY
}

print("Downloading EV stations from NLR API...")
response = requests.get(API_URL, params=params)
data = response.json()

stations = data["fuel_stations"]

# Keep only the fields you actually need
keep_fields = [
    "station_name",
    "latitude",
    "longitude",
    "ev_dc_fast_num",
    "access_code"
]

df = pd.DataFrame(stations)[keep_fields]

# Filter: public DC fast chargers
filtered = df[
    (df["ev_dc_fast_num"].fillna(0) > 0) &
    (df["access_code"].str.lower() == "public")
]

print(f"Total EV stations: {len(df)}")



print(f"Public DC fast chargers: {len(filtered)}")

filtered.to_csv("dc_fast_chargers_filtered.csv", index=False)
print("Saved dc_fast_chargers_filtered.csv")


