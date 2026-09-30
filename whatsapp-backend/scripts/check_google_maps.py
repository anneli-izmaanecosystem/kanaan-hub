"""Checks GOOGLE_MAPS_API_KEY before (and after) switching the bot to Google road distances.
Read-only: a handful of Google calls, nothing stored, the key never printed.

    python scripts/check_google_maps.py

For each API the bot uses it says whether the key works, then shows the driving distance
and time Google gives from the farm to the regular places, next to today's straight-line
estimate and the fare each would quote.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import httpx

from app.bot import places
from app.bot.settings_store import defaults, fare_for
from app.config import get_settings

CHECKS = {
    "Routes API": "the driving distance and time - this is what prices the trip",
    "Places API (New)": "finding a place the guest types (falls back to the built-in list)",
    "Geocoding API": "naming a pin the guest shares (falls back to 'the location you shared')",
}


def main() -> int:
    s = get_settings()
    if not s.google_maps_api_key:
        print("GOOGLE_MAPS_API_KEY is not set in whatsapp-backend/.env")
        return 1
    print(f"Farm pin: {s.kanaan_pickup_lat}, {s.kanaan_pickup_lng} (every distance is measured from here)\n")

    results = {}
    try:
        r = places._route_from_farm(-25.0075, 31.2394)
        results["Routes API"] = (True, f"Phabeni Gate {r['distanceKm']} km, {r['durationMin']} min")
    except Exception as err:
        results["Routes API"] = (False, str(err)[:200])
    try:
        p = places._search_place("Phabeni Gate Kruger")
        results["Places API (New)"] = (bool(p), p["name"] if p else "no result")
    except Exception as err:
        results["Places API (New)"] = (False, str(err)[:200])
    try:
        a = places._reverse_geocode(-25.0461, 31.1264)
        results["Geocoding API"] = (True, a or "no address")
    except Exception as err:
        results["Geocoding API"] = (False, str(err)[:200])

    for name, (ok, detail) in results.items():
        print(f"{'OK  ' if ok else 'FAIL'} {name:18} {detail}")
        if not ok:
            print(f"     -> needed for {CHECKS[name]}. Enable it for this key in Google Cloud.")

    if not results["Routes API"][0]:
        print("\nThe Routes API must work before the bot can use road distances.")
        return 1

    fares = defaults()
    print(f"\n{'place':42} {'estimate':>9} {'Google':>9} {'fare now':>9} {'fare':>6}")
    for key, name, lat, lng, _ in places.KNOWN_PLACES:
        if key in ("gods_window", "blyde", "graskop"):
            continue
        est = places.estimated_distance(lat, lng)
        try:
            road = places._route_from_farm(lat, lng)
        except Exception as err:
            print(f"{name:42} Routes error: {str(err)[:80]}")
            continue
        print(f"{name:42} {est['distanceKm']:>7.1f}km {road['distanceKm']:>7.1f}km "
              f"{'R%g' % fare_for(est['distanceKm'], fares):>9} {'R%g' % fare_for(road['distanceKm'], fares):>6}"
              f"   ({road['durationMin']} min)")
    print("\nKey works for routing. Redeploy the service to switch the bot to Google distances.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
