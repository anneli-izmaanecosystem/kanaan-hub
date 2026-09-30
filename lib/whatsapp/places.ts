// Resolving "Phabeni Gate" into a pin and a road distance.
//
// With GOOGLE_MAPS_API_KEY set, typed places are found with Google Places and every
// distance is the Google Routes driving distance from the farm. Without it — or when a
// Google call fails — the flow still runs: typed places come from the admin destinations
// and the built-in list, and distance is a straight-line estimate. `resolvePlace` and
// `resolveSharedLocation` are what the conversation calls; callers never see which.

import { config } from './config'
import { db, destinations } from '@/lib/db'
import { eq } from 'drizzle-orm'
import { googleMapsKey, reverseGeocode, routeFromFarm, searchPlace } from './google-maps'

export interface ResolvedPlace {
  /** Full name as the provider returns it — quoted back for the guest to confirm. */
  name: string
  lat: number
  lng: number
  /** Road distance from the farm. Drives the fare and the chat cutoff. */
  distanceKm: number
  durationMin: number
  /** Optional admin-set price that overrides the distance tariff. */
  fixedFare?: number | null
  /** True when the distance is the straight-line estimate, not a routed one. */
  estimated?: boolean
}

export interface Distance {
  distanceKm: number
  durationMin: number
  estimated: boolean
}

/** Great-circle distance. Only a fallback — real fares need road distance. */
function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371
  const dLat = ((bLat - aLat) * Math.PI) / 180
  const dLng = ((bLng - aLng) * Math.PI) / 180
  const lat1 = (aLat * Math.PI) / 180
  const lat2 = (bLat * Math.PI) / 180

  const h = Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2)
  return 2 * R * Math.asin(Math.sqrt(h))
}

/**
 * Roads wander, so a straight line understates the drive. This is the usual rule of
 * thumb, used only when Google is not configured or does not answer.
 */
const ROAD_FACTOR = 1.3
const AVG_KMH = 55

export function placesConfigured(): boolean {
  return Boolean(googleMapsKey())
}

/** The straight-line estimate — instant and free, but only approximate. */
export function estimatedDistanceFromFarm(lat: number, lng: number): Distance {
  const straight = haversineKm(config.pickupLat, config.pickupLng, lat, lng)
  const distanceKm = Math.round(straight * ROAD_FACTOR * 10) / 10
  return { distanceKm, durationMin: Math.max(5, Math.round((distanceKm / AVG_KMH) * 60)), estimated: true }
}

// Routes are paid per call and the same few points (the gates, Hazyview, saved
// destinations) come up all day, so answers are kept for a while. Keyed to ~10 m, which
// is finer than any pickup point needs. Per server process; a restart just re-asks.
const ROUTE_TTL_MS = 24 * 60 * 60 * 1000
const routeCache = new Map<string, { at: number; value: Distance }>()

/**
 * Driving distance and time from the farm. Google Routes when configured; otherwise, or
 * if Google fails, the estimate — flagged, and never cached, so the next ask retries.
 */
export async function distanceFromFarm(lat: number, lng: number): Promise<Distance> {
  if (!placesConfigured()) return estimatedDistanceFromFarm(lat, lng)

  const key = `${config.pickupLat},${config.pickupLng}>${lat.toFixed(4)},${lng.toFixed(4)}`
  const hit = routeCache.get(key)
  if (hit && Date.now() - hit.at < ROUTE_TTL_MS) return hit.value

  try {
    const route = await routeFromFarm(lat, lng)
    const value = { ...route, estimated: false }
    routeCache.set(key, { at: Date.now(), value })
    return value
  } catch (err) {
    console.error('[places] Google Routes failed, using the straight-line estimate —', (err as Error).message)
    return estimatedDistanceFromFarm(lat, lng)
  }
}

/**
 * A pin the guest shared. The coordinates are exact; Google supplies the road distance
 * and, when WhatsApp sent no place name, the street address to quote back.
 */
export async function resolveSharedLocation(lat: number, lng: number, name?: string): Promise<ResolvedPlace> {
  const [distance, address] = await Promise.all([
    distanceFromFarm(lat, lng),
    name || !placesConfigured()
      ? Promise.resolve(null)
      : reverseGeocode(lat, lng).catch(err => {
          console.error('[places] Google Geocoding failed —', (err as Error).message)
          return null
        }),
  ])
  return { name: name || address || 'the location you shared', lat, lng, ...distance }
}

/**
 * Turns typed text into a place. Returns null when nothing matches, which the
 * conversation surfaces as "try again" rather than guessing.
 *
 * Order: the admin's saved destinations (so aliases and fixed fares always win), then
 * Google Places, then the built-in landmarks — which also cover a Google outage.
 */
export async function resolvePlace(query: string): Promise<ResolvedPlace | null> {
  const q = query.toLowerCase().trim()
  if (!q) return null

  const saved = await db.select().from(destinations).where(eq(destinations.active, true))
  const savedMatch = saved.find(place => {
    const aliases = (place.aliases ?? '').split(',').map(alias => alias.trim()).filter(Boolean)
    return q.includes(place.name.toLowerCase()) || aliases.some(alias => q.includes(alias))
  })
  if (savedMatch) {
    const lat = Number(savedMatch.lat)
    const lng = Number(savedMatch.lng)
    return {
      name: savedMatch.name,
      lat,
      lng,
      ...(await distanceFromFarm(lat, lng)),
      fixedFare: savedMatch.fixedFare == null ? null : Number(savedMatch.fixedFare),
    }
  }

  if (placesConfigured()) {
    try {
      const found = await searchPlace(query)
      if (found) return { ...found, ...(await distanceFromFarm(found.lat, found.lng)) }
      return null
    } catch (err) {
      console.error('[places] Google Places failed, using the built-in list —', (err as Error).message)
    }
  }

  const match = KNOWN_PLACES.find(p => p.aliases.some(a => q.includes(a)))
  if (!match) return null
  return { name: match.name, lat: match.lat, lng: match.lng, ...(await distanceFromFarm(match.lat, match.lng)) }
}

/** Landmarks within reach of the farm, with the names guests actually use for them. */
const KNOWN_PLACES = [
  { name: 'Phabeni Gate, Kruger National Park',        lat: -25.0075, lng: 31.2394, aliases: ['phabeni'] },
  { name: 'Numbi Gate, Kruger National Park',          lat: -25.1503, lng: 31.1947, aliases: ['numbi'] },
  { name: 'Paul Kruger Gate, Kruger National Park',    lat: -24.9819, lng: 31.4869, aliases: ['paul kruger', 'kruger gate'] },
  { name: 'Hazyview town centre',                      lat: -25.0450, lng: 31.1250, aliases: ['hazyview'] },
  { name: 'Perry\'s Bridge Trading Post, Hazyview',    lat: -25.0392, lng: 31.1189, aliases: ['perry', 'perrys bridge'] },
  { name: 'Graskop',                                    lat: -24.9333, lng: 30.8500, aliases: ['graskop'] },
  { name: 'Sabie',                                      lat: -25.0972, lng: 30.7778, aliases: ['sabie'] },
  { name: 'White River',                                lat: -25.3319, lng: 31.0136, aliases: ['white river'] },
  { name: 'Nelspruit / Mbombela',                       lat: -25.4753, lng: 30.9694, aliases: ['nelspruit', 'mbombela'] },
  { name: 'Kruger Mpumalanga International Airport',    lat: -25.3832, lng: 31.1056, aliases: ['airport', 'kmia', 'mpumalanga international'] },
  { name: 'God\'s Window',                              lat: -24.8783, lng: 30.8917, aliases: ['god\'s window', 'gods window'] },
  { name: 'Blyde River Canyon',                         lat: -24.5866, lng: 30.8060, aliases: ['blyde', 'three rondavels'] },
]
