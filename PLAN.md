# Standalone Orchestrator

## Improvements

### Must Have
- [ ] test with innocent example issue

### Should Have

- [ ] improve concurrency
    - currently, it only uses the concurrency config entry to limit concurrency when being triggered by CRON. It should keep track of the opencode processes running concurrently at any time.

- OpenClaw features
    - channels and workspaces
    - https://ajithraghavan.github.io/blog/engineering-behind-openclaw/
    - https://medium.com/@ttio2tech_28094/inside-openclaw-how-it-works-ce1c1fd7aed1

### Could Have

- [ ] proper use of `opencode serve` with central server

## Testing

# OpenClaw Orchestrator Integration

- [ ] move config to this repo
- [ ] Docker isolation
- [ ] packaging: create plugin bundle