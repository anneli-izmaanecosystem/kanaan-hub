"""Resolving "Phabeni Gate" into a pin and a road distance from the farm.

With GOOGLE_MAPS_API_KEY set, typed places are found with Google Places (New) and every
distance is the Google Routes driving distance from the farm. Without it — or when a
Google call fails — the flow still runs: typed places come from the admin destinations
and the built-in list, and distance is a straight-line estimate. Callers never see which.

Places are plain dicts with camelCase keys, because they are stored in the conversation
draft next to what the earlier Next.js flow wrote.
"""

import logging
import math
import re
import threading
import time
from typing import Any, Optional

import httpx
from sqlalchemy import select

from app.bot import hub_db
from app.bot.settings_store import fixed_fares
from app.config import get_settings

log = logging.getLogger("kanaan.bot.places")

TIMEOUT = 6
ROAD_FACTOR = 1.3   # roads wander; only for the estimate
AVG_KMH = 55
SHARED = "the location you shared"


def places_configured() -> bool:
    return bool(get_settings().google_maps_api_key)


def _farm() -> tuple[float, float]:
    s = get_settings()
    return s.kanaan_pickup_lat, s.kanaan_pickup_lng


def _haversine_km(a_lat: float, a_lng: float, b_lat: float, b_lng: float) -> float:
    r = 6371
    d_lat = math.radians(b_lat - a_lat)
    d_lng = math.radians(b_lng - a_lng)
    h = math.sin(d_lat / 2) ** 2 + math.sin(d_lng / 2) ** 2 * math.cos(math.radians(a_lat)) * math.cos(math.radians(b_lat))
    return 2 * r * math.asin(math.sqrt(h))


def estimated_distance(lat: float, lng: float) -> dict[str, Any]:
    f_lat, f_lng = _farm()
    km = round(_haversine_km(f_lat, f_lng, lat, lng) * ROAD_FACTOR, 1)
    return {"distanceKm": km, "durationMin": max(5, round(km / AVG_KMH * 60)), "estimated": True}


# Routes are paid per call and the same points come up all day. Keyed to ~10 m; per
# process, so a restart just asks again.
_ROUTE_TTL = 24 * 3600
_route_cache: dict[str, tuple[float, dict[str, Any]]] = {}
_cache_lock = threading.Lock()


def _google_post(url: str, field_mask: str, body: dict[str, Any]) -> dict[str, Any]:
    key = get_settings().google_maps_api_key
    with httpx.Client(timeout=TIMEOUT) as client:
        res = client.post(url, json=body, headers={"X-Goog-Api-Key": key, "X-Goog-FieldMask": field_mask})
    if res.is_error:
        raise RuntimeError(f"Google {httpx.URL(url).host} {res.status_code}: {res.text[:300]}")
    return res.json()


def _route_from_farm(lat: float, lng: float) -> dict[str, Any]:
    """Driving distance from the farm — that is the way the car runs, even on a pickup."""
    f_lat, f_lng = _farm()
    data = _google_post(
        "https://routes.googleapis.com/directions/v2:computeRoutes",
        "routes.distanceMeters,routes.duration",
        {
            "origin": {"location": {"latLng": {"latitude": f_lat, "longitude": f_lng}}},
            "destination": {"location": {"latLng": {"latitude": lat, "longitude": lng}}},
            "travelMode": "DRIVE",
            # Traffic-unaware: the quote must be the same whenever the guest asks.
            "routingPreference": "TRAFFIC_UNAWARE",
            "units": "METRIC",
        },
    )
    route = (data.get("routes") or [None])[0]
    if not route or route.get("distanceMeters") is None:
        raise RuntimeError("Google Routes found no driving route")
    return {
        "distanceKm": round(route["distanceMeters"] / 1000, 1),
        "durationMin": max(1, round(float(str(route.get("duration", "0s")).rstrip("s") or 0) / 60)),
        "estimated": False,
    }


def distance_from_farm(lat: float, lng: float) -> dict[str, Any]:
    """{distanceKm, durationMin, estimated}. Google when configured, else the estimate."""
    if not places_configured():
        return estimated_distance(lat, lng)
    f_lat, f_lng = _farm()
    key = f"{f_lat},{f_lng}>{lat:.4f},{lng:.4f}"
    with _cache_lock:
        hit = _route_cache.get(key)
    if hit and time.time() - hit[0] < _ROUTE_TTL:
        return hit[1]
    try:
        value = _route_from_farm(lat, lng)
    except Exception as err:
        log.error("Google Routes failed, using the straight-line estimate - %s", err)
        return estimated_distance(lat, lng)
    with _cache_lock:
        _route_cache[key] = (time.time(), value)
    return value


def _trim_country(address: str) -> str:
    return re.sub(r",?\s*\d{4}$", "", re.sub(r",\s*South Africa$", "", address, flags=re.I)).strip()


def _place_label(name: Optional[str], address: Optional[str]) -> str:
    short = _trim_country(address) if address else ""
    if not name:
        return short or "that place"
    if not short or short.lower().startswith(name.lower()):
        return short or name
    parts = [p.strip() for p in short.split(",") if p.strip() and not p.strip().isdigit()]
    locality = parts[-1] if parts else None
    return f"{name}, {locality}" if locality and locality.lower() != name.lower() else name


def _reverse_geocode(lat: float, lng: float) -> Optional[str]:
    with httpx.Client(timeout=TIMEOUT) as client:
        res = client.get(
            "https://maps.googleapis.com/maps/api/geocode/json",
            params={"latlng": f"{lat},{lng}", "language": "en", "key": get_settings().google_maps_api_key},
        )
    data = res.json()
    if data.get("status") == "ZERO_RESULTS":
        return None
    if data.get("status") != "OK":
        raise RuntimeError(f"Google Geocoding {data.get('status')}: {data.get('error_message', '')}")
    address = (data.get("results") or [{}])[0].get("formatted_address")
    return _trim_country(address) if address else None


def _search_place(query: str) -> Optional[dict[str, Any]]:
    f_lat, f_lng = _farm()
    data = _google_post(
        "https://places.googleapis.com/v1/places:searchText",
        "places.displayName,places.formattedAddress,places.location",
        {
            "textQuery": query,
            "regionCode": "ZA",
            "languageCode": "en",
            "pageSize": 1,
            # 50 km is the most Places allows for a bias circle — and the chat limit anyway.
            "locationBias": {"circle": {"center": {"latitude": f_lat, "longitude": f_lng}, "radius": 50_000}},
        },
    )
    place = (data.get("places") or [None])[0]
    if not place or not place.get("location"):
        return None
    return {
        "name": _place_label((place.get("displayName") or {}).get("text"), place.get("formattedAddress")),
        "lat": place["location"]["latitude"],
        "lng": place["location"]["longitude"],
    }


def resolve_shared_location(lat: float, lng: float, name: Optional[str] = None) -> dict[str, Any]:
    """A pin the guest shared: exact coordinates, road distance, and a street address to
    quote back when WhatsApp sent no place name."""
    address = None
    if not name and places_configured():
        try:
            address = _reverse_geocode(lat, lng)
        except Exception as err:
            log.error("Google Geocoding failed - %s", err)
    return {"name": name or address or SHARED, "lat": lat, "lng": lng, **distance_from_farm(lat, lng), "shared": True}


def resolve_place(query: str) -> Optional[dict[str, Any]]:
    """Typed text to a place, or None. Saved destinations first (so aliases and fixed
    fares win), then Google Places, then the built-in landmarks (also the outage path)."""
    q = query.lower().strip()
    if not q:
        return None

    with hub_db.begin() as c:
        saved = hub_db.rows(c.execute(select(hub_db.destinations).where(hub_db.destinations.c.active.is_(True))))
    for place in saved:
        aliases = [a.strip() for a in (place.aliases or "").split(",") if a.strip()]
        if place.name.lower() in q or any(a in q for a in aliases):
            lat, lng = float(place.lat), float(place.lng)
            return {
                "name": place.name, "lat": lat, "lng": lng, **distance_from_farm(lat, lng),
                "fixedFare": None if place.fixed_fare is None else float(place.fixed_fare),
            }

    if places_configured():
        try:
            found = _search_place(query)
            return {**found, **distance_from_farm(found["lat"], found["lng"])} if found else None
        except Exception as err:
            log.error("Google Places failed, using the built-in list - %s", err)

    for key, name, lat, lng, aliases in KNOWN_PLACES:
        if any(a in q for a in aliases):
            return {"name": name, "lat": lat, "lng": lng, **distance_from_farm(lat, lng), "fixedFare": fixed_fares().get(key)}
    return None


# The places offered as one-tap choices for pickup and drop-off. Kanaan serves these by
# choice, so they are exempt from the chat distance limit (the airport sits right on it).
# Coordinates: OpenStreetMap (Perry's Bridge; the Engen at Lowveld Mall, R40 & R536) and
# the airport's published position.
PRESETS: dict[str, dict[str, Any]] = {
    "perrys": {"title": "Perry's Bridge", "description": "Trading Post, Hazyview",
               "name": "Perry's Bridge Trading Post, Hazyview", "lat": -25.0360270, "lng": 31.1248174},
    "lowveld": {"title": "Lowveld Mall (Engen)", "description": "Engen at Lowveld Mall, R40 & R536, Hazyview",
                "name": "Lowveld Mall (Engen), Hazyview", "lat": -25.0457399, "lng": 31.1296184},
    "airport": {"title": "Kruger Intl Airport", "description": "Kruger Mpumalanga International Airport",
                "name": "Kruger Mpumalanga International Airport", "lat": -25.3832, "lng": 31.1056},
}


def preset_place(key: str) -> Optional[dict[str, Any]]:
    p = PRESETS.get(key)
    if not p:
        return None
    return {"name": p["name"], "lat": p["lat"], "lng": p["lng"], **distance_from_farm(p["lat"], p["lng"]), "preset": key,
            "fixedFare": fixed_fares().get(key)}


# Landmarks within reach of the farm, with the names guests actually use for them.
KNOWN_PLACES = [
    # key (for KANAAN_FIXED_FARES), name, lat, lng, aliases
    ("phabeni", "Phabeni Gate, Kruger National Park", -25.0075, 31.2394, ["phabeni"]),
    ("numbi", "Numbi Gate, Kruger National Park", -25.1503, 31.1947, ["numbi"]),
    ("paul_kruger", "Paul Kruger Gate, Kruger National Park", -24.9819, 31.4869, ["paul kruger", "kruger gate"]),
    ("hazyview", "Hazyview town centre", -25.0450, 31.1250, ["hazyview"]),
    ("perrys", "Perry's Bridge Trading Post, Hazyview", -25.0360270, 31.1248174, ["perry", "perrys bridge"]),
    ("lowveld", "Lowveld Mall (Engen), Hazyview", -25.0457399, 31.1296184, ["lowveld mall", "engen"]),
    ("graskop", "Graskop", -24.9333, 30.8500, ["graskop"]),
    ("sabie", "Sabie", -25.0972, 30.7778, ["sabie"]),
    ("white_river", "White River", -25.3319, 31.0136, ["white river"]),
    ("nelspruit", "Nelspruit / Mbombela", -25.4753, 30.9694, ["nelspruit", "mbombela"]),
    ("airport", "Kruger Mpumalanga International Airport", -25.3832, 31.1056, ["airport", "kmia", "mpumalanga international"]),
    ("gods_window", "God's Window", -24.8783, 30.8917, ["god's window", "gods window"]),
    ("blyde", "Blyde River Canyon", -24.5866, 30.8060, ["blyde", "three rondavels"]),
]
