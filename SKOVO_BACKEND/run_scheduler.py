"""
Standalone scheduler runner.

Runs the APScheduler jobs (session lifecycle + reminders) in ONE dedicated
process, separate from the gunicorn web workers. The web app runs with
ENABLE_SCHEDULER=0, so this is the single place the jobs fire — no duplicate
reminder emails or racing cohort transitions across workers/instances.

Usage:
    python run_scheduler.py

In production (ECS/EC2) deploy this as its own single-task service.
"""
import os
import time

# Belt-and-suspenders: make sure the guard in app.py enables the scheduler here,
# even though we also call start_scheduler() explicitly below.
os.environ.setdefault("ENABLE_SCHEDULER", "1")

from app import app                       # noqa: E402  (env must be set first)
from portal.scheduler import start_scheduler  # noqa: E402


def main():
    # Idempotent: if app.py already started it on import, this is a no-op.
    start_scheduler(app)
    app.logger.info("Dedicated scheduler process running — jobs active.")
    try:
        while True:
            time.sleep(3600)
    except (KeyboardInterrupt, SystemExit):
        app.logger.info("Scheduler process shutting down.")


if __name__ == "__main__":
    main()
