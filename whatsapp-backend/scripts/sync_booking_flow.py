"""Registers the "Pick a day and time" WhatsApp Flow (app/bot/flows.py) on Kanaan's WABA.

    python scripts/sync_booking_flow.py            # create/update a DRAFT and validate it
    python scripts/sync_booking_flow.py --publish  # ...then publish it

Meta will not let a published flow change, so after publishing, a changed flow_json goes
into a new draft (named with a version suffix) that can be validated and published in
turn. Set the printed id as KANAAN_DATETIME_FLOW_ID and redeploy the service.

Reads WHATSAPP_BUSINESS_ACCOUNT_ID / WHATSAPP_ACCESS_TOKEN / WHATSAPP_API_VERSION from .env.
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import httpx

from app.bot.flows import FLOW_NAME, flow_json
from app.config import get_settings


def main() -> int:
    publish = "--publish" in sys.argv
    s = get_settings()
    base, waba = s.graph_base_url, s.whatsapp_business_account_id
    auth = {"Authorization": f"Bearer {s.whatsapp_access_token}"}
    body = json.dumps(flow_json(), separators=(",", ":"))

    with httpx.Client(timeout=60, headers=auth) as http:
        def call(method: str, url: str, **kw) -> dict:
            res = http.request(method, url, **kw)
            data = res.json()
            if res.is_error:
                raise SystemExit(f"{method} {url} -> {res.status_code}: {json.dumps(data.get('error', data))}")
            return data

        flows = call("GET", f"{base}/{waba}/flows", params={"fields": "id,name,status", "limit": 100}).get("data", [])
        ours = [f for f in flows if f["name"] == FLOW_NAME or f["name"].startswith(FLOW_NAME + "_v")]
        draft = next((f for f in ours if f["status"] == "DRAFT"), None)

        if draft:
            flow_id = draft["id"]
            print(f"updating draft {draft['name']} ({flow_id})")
            result = call("POST", f"{base}/{flow_id}/assets",
                          data={"name": "flow.json", "asset_type": "FLOW_JSON"},
                          files={"file": ("flow.json", body, "application/json")})
        else:
            name = FLOW_NAME if not ours else f"{FLOW_NAME}_v{len(ours) + 1}"
            print(f"creating draft {name}")
            result = call("POST", f"{base}/{waba}/flows",
                          json={"name": name, "categories": ["APPOINTMENT_BOOKING"], "flow_json": body})
            flow_id = result["id"]

        errors = result.get("validation_errors") or []
        if errors:
            print("Meta rejected the flow JSON:")
            for e in errors:
                print(" -", json.dumps(e))
            return 1
        print(f"valid. flow id: {flow_id}")

        if publish:
            call("POST", f"{base}/{flow_id}/publish")
            status = call("GET", f"{base}/{flow_id}", params={"fields": "status"}).get("status")
            print(f"published - status {status}")
        print(f"\nSet KANAAN_DATETIME_FLOW_ID={flow_id} and redeploy the service.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
