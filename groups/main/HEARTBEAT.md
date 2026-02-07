# Heartbeat

Keep this file empty (or with only comments) to skip heartbeat checks. Add tasks below when you want the agent to check something periodically.

These are checked when heartbeat-type scheduled tasks run. Update this file to add or remove monitoring checks.

## Active Checks

- OVH disk usage: alert if any partition >85%
- OVH memory: alert if available <500MB
- OVH load: alert if 5min avg > CPU count
- OVH failed services: alert on any
- apm2 CI: alert on failed runs
- apm2 PRs: flag stale PRs (>3 days no activity)
