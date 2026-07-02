"""
ec2_scheduler.py
----------------
Runs on your laptop and automatically starts/stops the EC2 instance
on a weekday business-hours schedule (Eastern time).

Default schedule:
  Mon-Fri  08:00 ET  ->  START
  Mon-Fri  19:00 ET  ->  STOP
  Sat-Sun             ->  stays off all weekend

Usage:
  python scripts/ec2_scheduler.py
  python scripts/ec2_scheduler.py start=09:00 stop=17:30
  python scripts/ec2_scheduler.py start=08:00
"""

import argparse
import logging
import re
import time
from datetime import datetime
from zoneinfo import ZoneInfo

import boto3
import schedule

# ── Config ────────────────────────────────────────────────────────────────────

INSTANCE_ID   = "i-093dbaa9b6e94596e"
REGION        = "us-east-1"
TIMEZONE      = ZoneInfo("America/New_York")
DEFAULT_START = "08:00"
DEFAULT_STOP  = "19:00"

# ── Logging ───────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%Y-%m-%d %H:%M",
)
log = logging.getLogger(__name__)

# ── Argument parsing ──────────────────────────────────────────────────────────

def _valid_time(value: str) -> str:
    """Validate HH:MM format (24-hour)."""
    if not re.fullmatch(r"([01]\d|2[0-3]):[0-5]\d", value):
        raise argparse.ArgumentTypeError(
            f"'{value}' is not valid military time — use HH:MM (e.g. 08:00, 17:30)"
        )
    return value


def parse_args():
    parser = argparse.ArgumentParser(
        description="EC2 business-hours scheduler (Eastern time)",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
examples:
  python scripts/ec2_scheduler.py
  python scripts/ec2_scheduler.py start=09:00 stop=17:30
  python scripts/ec2_scheduler.py start=08:00
        """,
    )
    # Support both  --start=08:00  and  start=08:00  styles
    parser.add_argument(
        "positional", nargs="*", metavar="key=HH:MM",
        help="start=HH:MM and/or stop=HH:MM",
    )
    parser.add_argument("--start", type=_valid_time, metavar="HH:MM",
                        help="Start time in 24-hour format (default: 08:00)")
    parser.add_argument("--stop",  type=_valid_time, metavar="HH:MM",
                        help="Stop  time in 24-hour format (default: 19:00)")

    args = parser.parse_args()

    # Parse key=value positional args (start=08:00 stop=19:00)
    for token in args.positional:
        if "=" not in token:
            parser.error(f"Unexpected argument '{token}' — use start=HH:MM or stop=HH:MM")
        key, _, val = token.partition("=")
        val = val.strip()
        if key == "start":
            args.start = _valid_time(val)
        elif key == "stop":
            args.stop = _valid_time(val)
        else:
            parser.error(f"Unknown key '{key}' — only 'start' and 'stop' are supported")

    # Apply defaults
    args.start = args.start or DEFAULT_START
    args.stop  = args.stop  or DEFAULT_STOP

    # Sanity check
    if args.start >= args.stop:
        parser.error(f"start ({args.start}) must be earlier than stop ({args.stop})")

    return args

# ── AWS helpers ───────────────────────────────────────────────────────────────

def _ec2():
    return boto3.client("ec2", region_name=REGION)


def _instance_state() -> str:
    resp = _ec2().describe_instances(InstanceIds=[INSTANCE_ID])
    return resp["Reservations"][0]["Instances"][0]["State"]["Name"]


def start_instance():
    state = _instance_state()
    if state == "running":
        log.info("START skipped — already running.")
        return
    if state not in ("stopped", "stopping"):
        log.warning("START skipped — unexpected state: %s", state)
        return
    _ec2().start_instances(InstanceIds=[INSTANCE_ID])
    log.info("✅  STARTED  (was: %s)", state)


def stop_instance():
    state = _instance_state()
    if state == "stopped":
        log.info("STOP skipped — already stopped.")
        return
    if state not in ("running", "pending"):
        log.warning("STOP skipped — unexpected state: %s", state)
        return
    _ec2().stop_instances(InstanceIds=[INSTANCE_ID])
    log.info("🛑  STOPPED  (was: %s)", state)

# ── Schedule ──────────────────────────────────────────────────────────────────

def _et_to_local(hhmm: str) -> str:
    """Convert an Eastern-time HH:MM to the laptop's local HH:MM for schedule."""
    hour, minute = int(hhmm[:2]), int(hhmm[3:])
    et_time  = datetime.now(TIMEZONE).replace(hour=hour, minute=minute, second=0, microsecond=0)
    return et_time.astimezone().strftime("%H:%M")


def register_schedule(start_et: str, stop_et: str):
    local_start = _et_to_local(start_et)
    local_stop  = _et_to_local(stop_et)

    for day in ["monday", "tuesday", "wednesday", "thursday", "friday"]:
        getattr(schedule.every(), day).at(local_start).do(start_instance)
        getattr(schedule.every(), day).at(local_stop ).do(stop_instance)

    return local_start, local_stop

# ── Entry point ───────────────────────────────────────────────────────────────

def main():
    args = parse_args()

    local_start, local_stop = register_schedule(args.start, args.stop)

    now_et = datetime.now(TIMEZONE)
    log.info("EC2 scheduler started.")
    log.info("  Instance : %s  (%s)", INSTANCE_ID, REGION)
    log.info("  Schedule : Mon-Fri  START %s ET  /  STOP %s ET", args.start, args.stop)
    if local_start != args.start:
        log.info("  (local)  : Mon-Fri  START %s      /  STOP %s",      local_start, local_stop)
    log.info("  Now (ET) : %s", now_et.strftime("%A %Y-%m-%d %H:%M"))

    # Catch-up: correct state if we're starting mid-day in the wrong state
    weekday       = now_et.weekday()           # 0=Mon … 4=Fri
    current_hhmm  = now_et.strftime("%H:%M")
    is_work_window = weekday < 5 and args.start <= current_hhmm < args.stop

    state = _instance_state()
    log.info("  EC2 state: %s", state)

    if is_work_window and state == "stopped":
        log.info("Catch-up: inside work window — starting now.")
        start_instance()
    elif not is_work_window and state == "running":
        log.info("Catch-up: outside work window — stopping now.")
        stop_instance()

    log.info("Scheduler running — press Ctrl+C to exit.")
    while True:
        schedule.run_pending()
        time.sleep(30)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        log.info("Scheduler stopped.")
