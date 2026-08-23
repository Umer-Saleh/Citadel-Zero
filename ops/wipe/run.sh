#!/bin/sh
# Scheduler for the nightly demo wipe.
#
# Sleeps until the next WIPE_HOUR_UTC:00, runs the wipe, repeats.
#
# Not crond, deliberately. BusyBox crond wants to run as root and
# write to /etc/crontabs, and the image this rides in runs as the
# unprivileged `node` user — adding root to a container whose only job
# is deleting a demo database is the wrong trade. What actually
# mattered was that the schedule ships with the compose file instead
# of living in a host crontab nobody redeploys, and it does.
#
# The wait is recomputed every cycle from the real clock, so a restart
# lands on the next slot rather than drifting, and a long wipe does
# not push the following night later.
set -e

HOUR="${WIPE_HOUR_UTC:-3}"

echo "[wipe-cron] scheduled daily at ${HOUR}:00 UTC"

# Run immediately on first boot only if asked. Off by default: a
# redeploy should not destroy the instance's data as a side effect.
if [ "${WIPE_ON_START}" = "true" ]; then
  echo "[wipe-cron] WIPE_ON_START set — running now"
  node scripts/wipe-demo.js || echo "[wipe-cron] run failed, staying up for the next slot"
fi

while true; do
  now=$(date -u +%s)
  # Today's slot; if it has already passed, tomorrow's.
  target=$(date -u -d "$(date -u +%Y-%m-%d) ${HOUR}:00:00" +%s 2>/dev/null \
           || date -u -j -f "%Y-%m-%d %H:%M:%S" "$(date -u +%Y-%m-%d) ${HOUR}:00:00" +%s)
  [ "$target" -le "$now" ] && target=$((target + 86400))

  wait=$((target - now))
  echo "[wipe-cron] next run in ${wait}s (at $(date -u -d "@${target}" +%Y-%m-%dT%H:%M:%SZ))"
  sleep "$wait"

  # Never exit on a failed wipe. A crash-looping container would keep
  # retrying a broken wipe every few seconds; staying up means one bad
  # night, not a hammered database.
  node scripts/wipe-demo.js || echo "[wipe-cron] run failed, waiting for the next slot"
done
