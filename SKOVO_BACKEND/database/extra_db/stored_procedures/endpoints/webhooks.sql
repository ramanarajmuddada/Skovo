-- ============================================================
-- SKOVO — Tailored endpoint stored procedures: the gateway webhook
-- ============================================================
-- Used by POST /webhooks/cashfree (server-to-server, signature-verified in
-- Python before either proc is called). Idempotent: if the synchronous
-- verify path already marked the enrollment paid, the webhook is a no-op.
-- ============================================================

DELIMITER $$

DELIMITER ;
