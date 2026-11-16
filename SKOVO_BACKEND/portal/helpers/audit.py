import uuid
import json
import logging

logger = logging.getLogger("skovo")


def log_audit(action, resource_type=None, resource_id=None, actor_id=None, meta=None, **kwargs):
    try:
        from portal.models import db
        from portal.helpers.sp import call_proc_one

        # ── SP: sp_audit_logs_create ─────────────────────────────────────────────
        call_proc_one(
            'sp_audit_logs_create',
            str(uuid.uuid4()), actor_id, action, resource_type, resource_id,
            None, None, json.dumps(meta or {}), None, None,
        )
        db.session.commit()
    except Exception as e:
        logger.warning(f"log_audit failed for action='{action}': {e}")
