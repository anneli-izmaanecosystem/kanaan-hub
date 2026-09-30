// Google Maps Platform calls behind places.ts: Places API (New) text search to turn a
// typed name into a pin, Routes API for the road distance from the farm, and Geocoding
// to give a shared pin a readable name.
//
// All three need GOOGLE_MAPS_API_KEY with those APIs enabled and billing on. Every call
// throws on failure; places.ts decides what to fall back to, so a Google outage degrades
// the quote to an estimate instead of stopping the booking.

import { config } from './config'

const TIMEOUT_MS = 6000

export function googleMapsKey(): string | null {
  return process.env.GOOGLE_MAPS_API_KEY || null
}

async function post<T>(url: string, fieldMask: string, body: object): Promise<T> {
  const key = googleMapsKey()
  if (!key) throw new Error('GOOGLE_MAPS_API_KEY is not set')
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': fieldMask },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`Google ${new URL(url).host} ${res.status}: ${(await res.text()).slice(0, 300)}`)
  return res.json() as Promise<T>
}

// ── road distance ────────────────────────────────────────────────────────────

export interface Route {
  distanceKm: number
  durationMin: number
}

/**
 * Driving distance and time from the farm to a point. Farm first, because that is the
 * way the car actually runs — even on a pickup it leaves the farm to collect the guest.
 */
export async function routeFromFarm(lat: number, lng: number): Promise<Route> {
  const data = await post<{ routes?: { distanceMeters?: number; duration?: string }[] }>(
    'https://routes.googleapis.com/directions/v2:computeRoutes',
    'routes.distanceMeters,routes.duration',
    {
      origin: { location: { latLng: { latitude: config.pickupLat, longitude: config.pickupLng } } },
      destination: { location: { latLng: { latitude: lat, longitude: lng } } },
      travelMode: 'DRIVE',
      // Traffic-unaware: the quote has to be the same whenever the guest asks.
      routingPreference: 'TRAFFIC_UNAWARE',
      units: 'METRIC',
    },
  )
  const route = data.routes?.[0]
  if (!route || route.distanceMeters == null) throw new Error('Google Routes found no driving route')
  return {
    distanceKm: Math.round(route.distanceMeters / 100) / 10,
    // Duration comes back as "1234s".
    durationMin: Math.max(1, Math.round(parseFloat(route.duration ?? '0') / 60)),
  }
}

// ── finding a typed place ────────────────────────────────────────────────────

export interface FoundPlace {
  name: string
  lat: number
  lng: number
}

/**
 * The best match for what the guest typed, biased to the area around the farm so
 * "Spar" means the one in Hazyview, not Cape Town. Null when Google has nothing.
 */
export async function searchPlace(query: string): Promise<FoundPlace | null> {
  const data = await post<{
    places?: { displayName?: { text?: string }; formattedAddress?: string; location?: { latitude: number; longitude: number } }[]
  }>(
    'https://places.googleapis.com/v1/places:searchText',
    'places.displayName,places.formattedAddress,places.location',
    {
      textQuery: query,
      regionCode: 'ZA',
      languageCode: 'en',
      pageSize: 1,
      locationBias: {
        // 50 km is the most Places allows for a bias circle — and the chat limit anyway.
        circle: { center: { latitude: config.pickupLat, longitude: config.pickupLng }, radius: 50_000 },
      },
    },
  )
  const place = data.places?.[0]
  if (!place?.location) return null
  return {
    name: placeLabel(place.displayName?.text, place.formattedAddress),
    lat: place.location.latitude,
    lng: place.location.longitude,
  }
}

/** A readable name for a shared pin — the street address, else null. */
export async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  const key = googleMapsKey()
  if (!key) throw new Error('GOOGLE_MAPS_API_KEY is not set')
  const url = new URL('https://maps.googleapis.com/maps/api/geocode/json')
  url.searchParams.set('latlng', `${lat},${lng}`)
  url.searchParams.set('language', 'en')
  url.searchParams.set('key', key)
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) })
  const data = (await res.json()) as { status: string; error_message?: string; results?: { formatted_address: string }[] }
  if (data.status === 'ZERO_RESULTS') return null
  if (data.status !== 'OK') throw new Error(`Google Geocoding ${data.status}: ${data.error_message ?? ''}`)
  const address = data.results?.[0]?.formatted_address
  return address ? trimCountry(address) : null
}

/** "Phabeni Gate, Kruger National Park" rather than a name repeated inside its address. */
function placeLabel(name: string | undefined, address: string | undefined): string {
  const short = address ? trimCountry(address) : ''
  if (!name) return short || 'that place'
  if (!short || short.toLowerCase().startsWith(name.toLowerCase())) return short || name
  // Name plus the locality — the last part before the postcode — is enough to recognise.
  const locality = short.split(',').map(p => p.trim()).filter(p => p && !/^\d+$/.test(p)).pop()
  return locality && locality.toLowerCase() !== name.toLowerCase() ? `${name}, ${locality}` : name
}

function trimCountry(address: string): string {
  return address.replace(/,\s*South Africa$/i, '').replace(/,?\s*\d{4}$/, '').trim()
}
