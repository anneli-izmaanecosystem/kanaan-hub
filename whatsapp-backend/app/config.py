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
