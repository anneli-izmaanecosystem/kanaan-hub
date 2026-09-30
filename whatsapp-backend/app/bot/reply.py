"""Flattening Meta's inbound message into what the state machine branches on."""

from dataclasses import dataclass
from typing import Any, Optional


FLOW_REPLY = "flow:completed"


@dataclass
class Reply:
    # Button/list id when tapped, else None — ids are stable, titles are not.
    reply_id: Optional[str]
    # Typed text, or the tapped button's visible title.
    text: str


def read_reply(m: dict[str, Any]) -> Reply:
    kind = m.get("type")
    if kind == "interactive":
        i = m.get("interactive") or {}
        if i.get("type") == "button_reply":
            return Reply(i["button_reply"]["id"], i["button_reply"]["title"])
        if i.get("type") == "list_reply":
            return Reply(i["list_reply"]["id"], i["list_reply"]["title"])
        if i.get("type") == "nfm_reply":
            # A completed WhatsApp Flow; its answers are read with flows.read_flow_reply.
            return Reply(FLOW_REPLY, "")
    if kind == "button":
        # A template quick-reply: no id we chose, only the visible text.
        b = m.get("button") or {}
        return Reply(None, (b.get("text") or b.get("payload") or "").strip())
    if kind == "text":
        return Reply(None, ((m.get("text") or {}).get("body") or "").strip())
    return Reply(None, "")


def said(reply: Reply, *labels: str) -> bool:
    """Whether a reply is one of these button labels (template buttons come back as text)."""
    t = reply.text.strip().lower()
    return any(label.lower() == t for label in labels)


def is_location(m: dict[str, Any]) -> bool:
    return m.get("type") == "location" and isinstance(m.get("location"), dict)


def context_id(m: dict[str, Any]) -> Optional[str]:
    """The wamid of the card a tap was on."""
    return (m.get("context") or {}).get("id")
