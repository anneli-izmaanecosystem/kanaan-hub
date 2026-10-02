import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.bot import scheduler
from app.config import get_settings
from app.routers import admin, bot, conversations, dashboard, internal, messages, payments, templates, webhook

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


def _log_payments_mode() -> None:
    from app.paystack import mode

    s = get_settings()
    log = logging.getLogger("kanaan.payments")
    m = mode(s)
    if not m:
        log.warning("PAYSTACK_SECRET_KEY is not set - payment links are not sent")
        return
    log.info("Paystack %s mode", m.upper())
    if m == "unknown":
        log.error("PAYSTACK_SECRET_KEY does not start with sk_live_ or sk_test_ - is it the secret key?")
    if m == "live" and "example.com" in s.paystack_guest_email:
        log.info("Paystack email receipts go to %s (unread placeholder - guests give no email; not a blocker)",
                 s.paystack_guest_email)
    if m == "live" and not s.paystack_callback_url:
        log.warning("live payments: PAYSTACK_CALLBACK_URL is not set - set it, or the Callback URL in Paystack's live settings")


@asynccontextmanager
async def lifespan(_: FastAPI):
    _log_payments_mode()
    scheduler.start()
    yield
    scheduler.stop()


# root_path is set on the app rather than via uvicorn's --root-path: uvicorn prepends it to
# the incoming path, which would double it since the ingress already forwards the prefix.
app = FastAPI(title="Kanaan WhatsApp Backend", version="0.2.0", root_path=get_settings().root_path, lifespan=lifespan)

app.include_router(templates.router)
app.include_router(webhook.router)
app.include_router(internal.router)
app.include_router(conversations.router)
app.include_router(messages.router)
app.include_router(payments.router)
app.include_router(bot.router)
app.include_router(dashboard.router)
app.include_router(admin.router)

if get_settings().simulator:
    # Local testing only: nothing is sent to Meta or Paystack (see app/sim).
    from app import sim

    sim.enable()
    app.include_router(sim.router)
    logging.getLogger("kanaan.sim").warning("SIMULATOR MODE - open /sim; nothing is sent to Meta or Paystack")


@app.get("/health")
def health():
    from app.paystack import mode

    return {"status": "ok", "bot": get_settings().bot_configured, "payments": mode(get_settings()) or "off"}
