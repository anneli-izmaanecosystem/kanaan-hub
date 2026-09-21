"""Gates the JSON API (templates, conversations, messages/send) on a Supabase-authenticated
user. Whatever calls these endpoints signs in through Supabase first (same project already
used for storage in the Next.js app — see lib/storage.ts) and sends the resulting access
token as `Authorization: Bearer <token>`.

Verification is delegated to Supabase itself (GET /auth/v1/user) rather than decoding the
JWT locally — no key material to manage here, and it can't go stale if Supabase rotates
signing keys. The cost is one network round trip per request, which is fine at admin-UI
traffic levels; swap to local JWT verification (PyJWT + the project's JWT secret) if that
ever matters.

Fails closed: if SUPABASE_URL/SUPABASE_ANON_KEY aren't set, every request is refused
rather than the routes quietly staying open.
"""

from typing import Any, Optional

import httpx
from fastapi import Depends, Header, HTTPException

from app.config import Settings, get_settings


async def require_supabase_user(
    authorization: Optional[str] = Header(None),
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    if not settings.supabase_auth_configured:
        raise HTTPException(503, "Supabase auth not configured")

    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Missing bearer token")
    token = authorization.removeprefix("Bearer ")

    async with httpx.AsyncClient(timeout=10) as client:
        res = await client.get(
            f"{settings.supabase_url}/auth/v1/user",
            headers={"apikey": settings.supabase_anon_key, "Authorization": f"Bearer {token}"},
        )
    if res.is_error:
        raise HTTPException(401, "Invalid or expired session")
    return res.json()
