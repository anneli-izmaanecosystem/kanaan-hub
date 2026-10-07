from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str

    whatsapp_phone_number_id: str = ""
    whatsapp_business_account_id: str = ""
    whatsapp_access_token: str = ""
    whatsapp_app_secret: str = ""
    whatsapp_verify_token: str = ""
    whatsapp_api_version: str = "v21.0"

    admin_username: str = ""
    admin_password: str = ""

    # Shared secret the Next.js app sends as X-Internal-Secret when mirroring its own
    # conversation (which it owns end-to-end, Stripe included) into this service's
    # tables for admin visibility. Empty means the /internal/* routes refuse everything.
    internal_mirror_secret: str = ""

    # Same Supabase project already used elsewhere in kanaan-hub for storage
    # (lib/storage.ts) — the anon key here is the public, client-safe one, used only to
    # ask Supabase "is this access token valid", never the service role key.
    supabase_url: str = ""
    supabase_anon_key: str = ""

    # Path prefix the service is mounted under behind a reverse proxy that forwards the
    # prefix unchanged (e.g. "/kanaan" on the shared staging ingress host). Requests that
    # arrive without it still route, so local dev at "/" is unaffected.
    root_path: str = ""

    # Paystack — the guest pays the fare by link once the trip is complete
    # (app/routers/payments.py). The secret key also verifies Paystack's webhook
    # signature, so without it the webhook refuses everything.
    paystack_secret_key: str = ""
    # Where the guest's browser returns after the card page. Unset falls back to the
    # Callback URL set in the Paystack dashboard.
    paystack_callback_url: str = ""
    # Paystack needs a customer email but guests book by WhatsApp and give none. A pattern
    # with {phone}; example.com is reserved and never delivers. Point it at a mailbox
    # Kanaan owns for live use.
    paystack_guest_email: str = "wa{phone}@example.com"
    # The business WhatsApp number the "Payment received" page links back to.
    kanaan_whatsapp_number: str = "27642116345"

    # ── the car-booking bot (app/bot) ────────────────────────────────────────
    # The bot's own data — trips, drivers, conversations, fare settings — lives in the
    # kanaan_hub database, where the Next.js dashboard reads it. Empty disables the bot:
    # webhooks are still logged, but nobody is answered.
    kanaan_hub_database_url: str = ""

    # Fallbacks for the transfer_settings row, which the owner edits in the dashboard.
    kanaan_ops_phone: str = "063 794 3880"      # as quoted to guests
    kanaan_ops_whatsapp: str = ""               # E.164, where Anneli's cards go
    kanaan_pickup_name: str = "Kanaan Guest Farm"
    kanaan_pickup_address: str = "Kanaan Guest Farm, R40 Hazyview"
    kanaan_pickup_lat: float = -25.063060      # the farm gate, as given by Kanaan (2026-10-07)
    kanaan_pickup_lng: float = 31.108593
    # Upfront fare: base + per km, never below the minimum (dashboard transfer settings win
    # over these). R8.30/km is UberX South Africa's R7.50/km with its R0.75/min folded in -
    # time here comes from distance at an average speed, so a separate time rate added
    # nothing but a second number.
    kanaan_fare_base: float = 5
    kanaan_fare_per_km: float = 8.30
    kanaan_fare_minimum: float = 20
    # Fixed prices for regular trips, kept in the backend: "key=rand,key=rand", e.g.
    # "airport=750,phabeni=300". Keys: perrys, lowveld, airport, phabeni, numbi,
    # paul_kruger, hazyview. They apply to and from the farm, override the per-km fare,
    # and are shown to the guest only at the quote. Empty = the per-km fare everywhere.
    kanaan_fixed_fares: str = ""
    kanaan_max_chat_km: int = 50
    kanaan_no_show_wait_min: int = 12
    kanaan_ops_response_min: int = 15
    kanaan_hold_before_min: int = 60
    kanaan_driver_nudge_before_min: int = 25

    # The published "Pick a day and time" WhatsApp Flow (scripts/sync_booking_flow.py prints
    # it). Empty = the guest types the day and time instead.
    kanaan_datetime_flow_id: str = ""

    # Google Maps Platform (Routes, Places (New), Geocoding). Empty = straight-line
    # distance estimate and the built-in place list.
    google_maps_api_key: str = ""

    # OpenRouteService (OpenStreetMap roads): the road distance between two points when
    # there is no Google key. Place search is unaffected. Empty = straight-line estimate.
    openrouteservice_api_key: str = ""

    # The scheduled sends (reminders, chasing Anneli, no-shows) run in-process on this
    # interval. Several replicas are safe: a Postgres advisory lock lets one tick at a time.
    bot_scheduler_enabled: bool = True
    bot_scheduler_interval_sec: int = 120

    # Local WhatsApp simulator (app/sim): captures every send instead of calling Meta, fakes
    # Paystack, and serves /sim. For testing on one machine only - never set on a server.
    simulator: bool = False

    @property
    def bot_configured(self) -> bool:
        return bool(self.kanaan_hub_database_url)

    @property
    def whatsapp_configured(self) -> bool:
        return bool(self.whatsapp_phone_number_id and self.whatsapp_access_token)

    @property
    def supabase_auth_configured(self) -> bool:
        return bool(self.supabase_url and self.supabase_anon_key)

    @property
    def graph_base_url(self) -> str:
        return f"https://graph.facebook.com/{self.whatsapp_api_version}"


@lru_cache
def get_settings() -> Settings:
    return Settings()
