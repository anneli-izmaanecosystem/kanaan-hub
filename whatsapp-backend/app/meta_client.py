"""Thin wrapper around the WhatsApp Cloud API (Meta Graph API) for Kanaan's WABA.

Mirrors the request shapes already proven out in lib/whatsapp/client.ts on the Next.js
side (same API version default, same template component shape) so a template or payload
that works there works here too.
"""

import hashlib
import hmac
from typing import Any, Optional

import httpx

from app.config import Settings


class MetaGraphError(Exception):
    def __init__(self, message: str, status_code: int, body: Any):
        super().__init__(message)
        self.status_code = status_code
        self.body = body


def verify_webhook_signature(payload: bytes, signature_header: Optional[str], app_secret: str) -> bool:
    """Checks Meta's X-Hub-Signature-256 header. Meta signs every webhook POST with the
    app secret; a mismatch means the request did not come from Meta."""
    if not signature_header or not app_secret:
        return False
    if not signature_header.startswith("sha256="):
        return False
    expected = hmac.new(app_secret.encode(), payload, hashlib.sha256).hexdigest()
    provided = signature_header.removeprefix("sha256=")
    return hmac.compare_digest(expected, provided)


class MetaClient:
    def __init__(self, settings: Settings):
        self._settings = settings
        self._base = settings.graph_base_url
        self._token = settings.whatsapp_access_token

    def _headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self._token}", "Content-Type": "application/json"}

    def _request(self, method: str, url: str, **kwargs) -> dict[str, Any]:
        with httpx.Client(timeout=20) as client:
            res = client.request(method, url, headers=self._headers(), **kwargs)
        body = res.json() if res.content else {}
        if res.is_error:
            detail = body.get("error", {}).get("message", res.text)
            raise MetaGraphError(f"Graph API error: {detail}", res.status_code, body)
        return body

    # ── Sending ────────────────────────────────────────────────────────────────

    def send_text(self, to: str, body: str) -> Optional[str]:
        return self._send({"to": to, "type": "text", "text": {"body": body, "preview_url": False}})

    def send_template(
        self,
        to: str,
        name: str,
        language: str = "en_GB",
        body_params: Optional[list[str]] = None,
    ) -> Optional[str]:
        components = []
        if body_params:
            components.append(
                {"type": "body", "parameters": [{"type": "text", "text": p} for p in body_params]}
            )
        payload: dict[str, Any] = {
            "to": to,
            "type": "template",
            "template": {"name": name, "language": {"code": language}},
        }
        if components:
            payload["template"]["components"] = components
        return self._send(payload)

    def _send(self, payload: dict[str, Any]) -> Optional[str]:
        phone_number_id = self._settings.whatsapp_phone_number_id
        url = f"{self._base}/{phone_number_id}/messages"
        body = self._request("POST", url, json={"messaging_product": "whatsapp", **payload})
        messages = body.get("messages") or []
        return messages[0]["id"] if messages else None

    # ── Template registration ────────────────────────────────────────────────

    def create_template(
        self,
        name: str,
        language: str,
        category: str,
        components: list[dict[str, Any]],
    ) -> dict[str, Any]:
        """Submits a template for Meta review. Returns Graph's response, which carries
        the new template's id and initial status (usually PENDING)."""
        waba_id = self._settings.whatsapp_business_account_id
        url = f"{self._base}/{waba_id}/message_templates"
        return self._request(
            "POST",
            url,
            json={"name": name, "language": language, "category": category, "components": components},
        )

    def list_templates(self) -> list[dict[str, Any]]:
        waba_id = self._settings.whatsapp_business_account_id
        url = f"{self._base}/{waba_id}/message_templates"
        body = self._request("GET", url, params={"limit": 200})
        return body.get("data", [])

    def delete_template(self, name: str) -> None:
        waba_id = self._settings.whatsapp_business_account_id
        url = f"{self._base}/{waba_id}/message_templates"
        self._request("DELETE", url, params={"name": name})
