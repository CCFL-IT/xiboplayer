# Running xiboplayer in Docker

One image runs both pieces: `@xiboplayer/proxy` serves the built PWA at
`/player/` and provides the same-origin endpoints the PWA needs
(`/xmds-proxy`, `/api/*`, `/config`, `/store/*`).

```bash
cp .env.example .env                                     # optional overrides
cp docker/config.example.json docker/config/config.json  # optional
docker compose up -d --build
```

Point nginx at port 8765 (see below) and open `https://<your-domain>/player/`.
With no CMS configured, the player shows
the setup screen. Anything saved there is written to `docker/config/config.json`.

## Configuration

| Source | Location | Notes |
|--------|----------|-------|
| `config.json` | `docker/config/config.json` → `/config/config.json` | Same format as the Electron/Chromium shells. Shell keys (`serverPort`, `relaxSslCerts`, `allowShellCommands`) configure the proxy; every other key is injected into the PWA. |
| Environment | `.env` | Non-empty values override `config.json`. See `.env.example` for the full list. |

Env-provided CMS settings (`CMS_URL`, `CMS_KEY`, ...) win on every restart,
even over changes made later in the setup screen. Leave them empty if you
want to manage the CMS connection from the setup screen.

| Volume | Purpose |
|--------|---------|
| `/config` | `config.json` (ownership is fixed automatically on start) |
| `/data` | Downloaded media cache |

## Behind nginx (TLS)

The container only speaks plain HTTP. Terminate TLS in nginx and proxy
everything through. Browsers only register the player's service worker over
HTTPS (or `localhost`), so displays should use the nginx URL.

```nginx
location / {
    proxy_pass http://127.0.0.1:8765;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_buffering off;             # stream media / range requests
    proxy_read_timeout 300s;         # large chunk downloads
    client_max_body_size 50m;        # PUT /store uploads
}
```

## Shared-server caveats

Every display that loads this server shares one proxy instance:

- **One CMS.** Cache misses and `/api/*` go to the server's single `cmsUrl`.
- **Per-display identity stays on the display.** `hardwareKey`, `displayName`
  and XMR keys are never injected from `config.json` / env (they'd be
  identical on every display).
- **Setup screen is global.** Saving the setup screen on any display updates
  the server config that gets injected into *all* displays.
- **Ctrl+Q restarts the server.** The PWA's quit shortcut POSTs `/quit`, which
  exits the process; `restart: unless-stopped` brings it back.

## Without compose

```bash
docker build -t xiboplayer .
docker run -d -p 8765:8765 --env-file .env \
  -v "$PWD/docker/config:/config" -v xiboplayer-data:/data xiboplayer
```
