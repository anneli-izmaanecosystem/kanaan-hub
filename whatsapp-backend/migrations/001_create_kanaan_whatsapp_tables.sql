-- Kanaan WhatsApp tables: templates, message log, chatbot flow state.
-- Lives in the notification_service database, alongside crm_email_template,
-- notification_view_logs, alert, etc. Column conventions match that schema:
-- varchar(36) UUID-string ids (app-generated, no DB default — see app/models.py),
-- plain `timestamp` (no tz), and JSON stored as TEXT rather than jsonb (same as
-- alert.data / crm_email_template have no native json/jsonb columns either).
--
-- Run via scripts/migrate.py. Idempotent — safe to re-run.

CREATE TABLE IF NOT EXISTS kanaan_whatsapp_templates (
    id               VARCHAR(36) PRIMARY KEY,
    name             VARCHAR NOT NULL,
    language         VARCHAR NOT NULL DEFAULT 'en_GB',
    category         VARCHAR NOT NULL,              -- MARKETING | UTILITY | AUTHENTICATION
    status           VARCHAR NOT NULL DEFAULT 'DRAFT', -- DRAFT | PENDING | APPROVED | REJECTED | PAUSED | DISABLED
    meta_template_id VARCHAR,                        -- id Meta assigns once submitted
    components       TEXT NOT NULL DEFAULT '[]',      -- header/body/footer/buttons JSON, exactly as sent to Graph
    body_preview     TEXT,                            -- rendered body with {{1}} placeholders, for admin display
    rejected_reason  TEXT,
    created_by       VARCHAR,
    submitted_at     TIMESTAMP,
    reviewed_at      TIMESTAMP,
    created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (name, language)
);

CREATE TABLE IF NOT EXISTS kanaan_whatsapp_flows (
    id                  VARCHAR(36) PRIMARY KEY,
    phone_number        VARCHAR NOT NULL,            -- E.164
    flow_name           VARCHAR NOT NULL DEFAULT 'kanaan_chatbot',
    status              VARCHAR NOT NULL DEFAULT 'active', -- active | completed | abandoned
    current_step        VARCHAR,
    context             TEXT NOT NULL DEFAULT '{}',  -- answers collected so far, as JSON
    started_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_interaction_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at        TIMESTAMP
);

-- One active session per (phone, flow) at a time — a new inbound message resumes it
-- rather than starting a duplicate.
CREATE UNIQUE INDEX IF NOT EXISTS kanaan_whatsapp_flows_active_unique
    ON kanaan_whatsapp_flows (phone_number, flow_name)
    WHERE status = 'active';

CREATE INDEX IF NOT EXISTS kanaan_whatsapp_flows_phone_idx
    ON kanaan_whatsapp_flows (phone_number, last_interaction_at DESC);

CREATE TABLE IF NOT EXISTS kanaan_whatsapp_logs (
    id             VARCHAR(36) PRIMARY KEY,
    wa_message_id  VARCHAR UNIQUE,                   -- Meta's wamid; makes webhook retries idempotent
    flow_id        VARCHAR(36) REFERENCES kanaan_whatsapp_flows(id) ON DELETE SET NULL,
    direction      VARCHAR NOT NULL,                 -- inbound | outbound
    phone_number   VARCHAR NOT NULL,                 -- the guest/counterparty's E.164 number
    message_type   VARCHAR NOT NULL,                 -- text | interactive | template | location | image | other
    template_name  VARCHAR,                          -- set only when message_type = 'template'
    body           TEXT,                             -- rendered text, for the admin thread view
    payload        TEXT NOT NULL DEFAULT '{}',        -- raw Meta payload, sent or received, as JSON
    status         VARCHAR NOT NULL DEFAULT 'received', -- sent | delivered | read | failed | received
    error_message  TEXT,
    created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS kanaan_whatsapp_logs_phone_idx
    ON kanaan_whatsapp_logs (phone_number, created_at);
