from fastapi import FastAPI

from app.routers import admin, conversations, internal, messages, templates, webhook

app = FastAPI(title="Kanaan WhatsApp Backend", version="0.1.0")

app.include_router(templates.router)
app.include_router(webhook.router)
app.include_router(internal.router)
app.include_router(conversations.router)
app.include_router(messages.router)
app.include_router(admin.router)


@app.get("/health")
def health():
    return {"status": "ok"}
