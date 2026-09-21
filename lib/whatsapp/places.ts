// Resolving "Phabeni Gate" into a pin and a road distance.
//
// No geocoder has been chosen yet, so this is the seam. `resolvePlace` is what the
// conversation calls; swapping in Google Places + Distance Matrix (or Mapbox) means
// implementing one function and leaving every caller alone.

import { config } from './config'
import { db, destinations } from '@/lib/db'
import { eq } from 'drizzle-orm'

export interface ResolvedPlace {
  /** Full name as the provider returns it — quoted back for the guest to confirm. */
  name: string
  lat: number
  lng: number
  /** Road distance from the farm, not straight line. Drives the fare and the cutoff. */
  distanceKm: number
  durationMin: number
  /** Optional admin-set price that overrides the distance tariff. */
  fixedFare?: number | null
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
 * thumb and exists only so the stub quotes something sane — a real provider returns
 * the actual routed distance and this constant disappears with it.
 */
const ROAD_FACTOR = 1.3
const AVG_KMH = 55

export function placesConfigured(): boolean {
  return Boolean(process.env.GOOGLE_MAPS_API_KEY)
}

/** Distance and drive time from the farm to a known point. */
export function distanceFromFarm(lat: number, lng: number): { distanceKm: number; durationMin: number } {
  const straight = haversineKm(config.pickupLat, config.pickupLng, lat, lng)
  const distanceKm = Math.round(straight * ROAD_FACTOR * 10) / 10
  return { distanceKm, durationMin: Math.max(5, Math.round((distanceKm / AVG_KMH) * 60)) }
}

/** A pin the guest shared. No lookup needed — we already have coordinates. */
export function resolveSharedLocation(
  lat: number,
  lng: number,
  name?: string,
): ResolvedPlace {
  const { distanceKm, durationMin } = distanceFromFarm(lat, lng)
  return { name: name || 'the location you shared', lat, lng, distanceKm, durationMin }
}

/**
 * Turns typed text into a place. Returns null when nothing matches, which the
 * conversation surfaces as "try again" rather than guessing.
 *
 * The stub covers the landmarks around Hazyview that guests actually ask for, so the
 * flow is testable end to end before a geocoder is wired up. Anything else returns
 * null — better than inventing coordinates and quoting a fare against them.
 */
export async function resolvePlace(query: string): Promise<ResolvedPlace | null> {
  const q = query.toLowerCase().trim()
  if (!q) return null

  // Admin-managed destinations take precedence over the built-in starter list. This
  // makes additions, aliases and fixed fares from the dashboard effective immediately.
  const saved = await db.select().from(destinations).where(eq(destinations.active, true))
  const savedMatch = saved.find(place => {
    const aliases = (place.aliases ?? '').split(',').map(alias => alias.trim()).filter(Boolean)
    return q.includes(place.name.toLowerCase()) || aliases.some(alias => q.includes(alias))
  })
  if (savedMatch) {
    const lat = Number(savedMatch.lat)
    const lng = Number(savedMatch.lng)
    const { distanceKm, durationMin } = distanceFromFarm(lat, lng)
    return {
      name: savedMatch.name,
      lat,
      lng,
      distanceKm,
      durationMin,
      fixedFare: savedMatch.fixedFare == null ? null : Number(savedMatch.fixedFare),
    }
  }

  if (placesConfigured()) {
    return resolveViaGoogle(query)
  }

  const match = KNOWN_PLACES.find(p => p.aliases.some(a => q.includes(a)))
  if (!match) return null

  const { distanceKm, durationMin } = distanceFromFarm(match.lat, match.lng)
  return { name: match.name, lat: match.lat, lng: match.lng, distanceKm, durationMin }
}

async function resolveViaGoogle(_query: string): Promise<ResolvedPlace | null> {
  // Deliberately unimplemented. Wiring this up is Places Text Search for the pin, then
  // Distance Matrix from the farm for road distance and duration — two calls, both
  // needing billing enabled on GOOGLE_MAPS_API_KEY.
  throw new Error('Google Places lookup is not implemented yet — unset GOOGLE_MAPS_API_KEY to use the built-in place list')
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
