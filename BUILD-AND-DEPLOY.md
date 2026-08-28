# Build and deploy

Deploying Origo to Ubuntu with nginx, and where PM2 fits.

**Read this first: Origo itself needs no Node process at runtime.** `npm run build` produces a
directory of static files — HTML, a JavaScript bundle, CSS, images and JSON. nginx serves them
directly. PM2 is a process manager for long-running Node applications, and there is no such
application in this repository, so PM2 has no role in serving the map.

PM2 becomes the right tool the moment you add a **backend**, and Origo has one optional feature
that requires one: `sharemap` with `storeMethod: "saveStateToServer"` needs an HTTP endpoint to
store map states. That is what [`origo-map/origo-server`](https://github.com/origo-map/origo-server)
provides, and running it under PM2 behind the same nginx is covered in
[Backend services under PM2](#backend-services-under-pm2). If you are not using that feature,
skip that section entirely — you will have a complete, working deployment without it.

## Contents

- [Prerequisites](#prerequisites)
- [Building](#building)
- [Preparing the build for production](#preparing-the-build-for-production)
- [nginx](#nginx)
- [TLS](#tls)
- [Deploying under a sub-path](#deploying-under-a-sub-path)
- [Backend services under PM2](#backend-services-under-pm2)
- [Proxying map services](#proxying-map-services)
- [The service worker](#the-service-worker)
- [Updating and rolling back](#updating-and-rolling-back)
- [Post-deploy checklist](#post-deploy-checklist)

## Prerequisites

On a fresh Ubuntu server:

```bash
sudo apt update && sudo apt install -y nginx git curl
```

Node.js is needed only to *build*. If you build on a workstation or in CI and ship the output,
the server does not need Node at all. To build on the server, install a current LTS — the
project's stated minimum is "current LTS or higher":

```bash
curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
sudo apt install -y nodejs
```

## Building

```bash
git clone https://github.com/matself/origo_me.git
cd origo_me
npm ci
npm run build
```

Use `npm ci` rather than `npm install` — it installs exactly what `package-lock.json` pins,
which is what makes a build reproducible. Do not pass `--omit=dev`: webpack, Sass and the
loaders are all devDependencies, so the build needs them.

`npm run build` runs three steps — the minified bundle into `dist/`, the compiled stylesheet,
and a copy step that assembles everything into `build/`:

```
build/
├── index.html          the application page
├── index.json          the map configuration
├── js/origo.js         unminified bundle, 8.4 MB
├── js/origo.min.js     minified bundle, 2.6 MB
├── css/                stylesheet, SVG sprites, print images
├── img/                icons and logos
├── data/               the demo geojson layers
└── examples/           sample configurations
```

Everything under `build/` is the deployable artifact. Nothing outside it is needed at runtime.

**This fork commits `build/`,** which gives you a second option: deploy straight from the
repository without building on the server at all. That is only safe if the committed bundles are
current — see the rebuild rule in `.claude/skills/origo-compliance/SKILL.md`. If in doubt,
rebuild.

## Preparing the build for production

Two edits to `build/index.html` that the build does not make for you.

**1. Switch to the minified bundle.** The shipped `index.html` loads the *unminified* bundle:

```html
<script src="js/origo.js"></script>
```

Change it to:

```html
<script src="js/origo.min.js"></script>
```

This matters more than it looks. Unminified is 8.4 MB; minified is 2.6 MB; minified and gzipped
by nginx is about 0.7 MB. That is a twelvefold reduction in what a first-time visitor downloads,
and on a mobile connection it is the difference between a map that appears and one that does not.

**2. Enable the security meta tags.** `index.html` ships with a Content-Security-Policy and a
referrer policy commented out, with a note that production systems should add them. Uncomment
them and extend `connect-src` with every host the map actually talks to — your WMS/WFS servers,
any geocoder, any analytics:

```html
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src * data:; script-src 'self' 'unsafe-inline' 'unsafe-eval'; connect-src 'self' geodata.example.com; style-src 'self' 'unsafe-inline'; style-src-elem 'self' 'unsafe-inline'; base-uri 'self'; form-action 'self';">
<meta name="referrer" content="same-origin">
```

Test the map with the CSP active before going live — a missing `connect-src` host fails silently
as layers that never load, which is easy to misdiagnose as a server problem.

Then publish:

```bash
sudo mkdir -p /var/www/origo
sudo rsync -a --delete build/ /var/www/origo/
sudo chown -R www-data:www-data /var/www/origo
```

`--delete` keeps removed files from lingering; drop it if the webroot holds anything the build
does not produce.

## nginx

`/etc/nginx/sites-available/origo`:

```nginx
server {
    listen 80;
    server_name karta.example.se;

    root /var/www/origo;
    index index.html;

    # The README recommends compression: it takes the bundle from 2.6 MB to
    # roughly 0.7 MB on the wire.
    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_proxied any;
    gzip_types
        application/javascript
        application/json
        application/geo+json
        text/css
        text/plain
        image/svg+xml;

    # The bundle filenames are not content-hashed, so a long max-age would
    # strand browsers on a stale build. Revalidate the entry points on every
    # request and let ETags make that cheap.
    location = /index.html          { add_header Cache-Control "no-cache"; }
    location = /index.json          { add_header Cache-Control "no-cache"; }
    location = /service-worker.js   { add_header Cache-Control "no-cache"; }

    location /js/  { add_header Cache-Control "public, max-age=3600, must-revalidate"; }
    location /css/ { add_header Cache-Control "public, max-age=3600, must-revalidate"; }
    location /img/  { expires 7d; }
    location /data/ { expires 1d; }

    location / {
        try_files $uri $uri/ =404;
    }

    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
}
```

`X-Frame-Options: SAMEORIGIN` blocks other sites from embedding the map in an iframe. Origo
supports embedding deliberately — `isEmbedded()`, `hideWhenEmbedded`, the URL parameters in
`SHAREMAP.md` — so if other sites are meant to embed this map, drop that header and use
`frame-ancestors` in the CSP to name the permitted hosts instead.

Enable and reload:

```bash
sudo ln -s /etc/nginx/sites-available/origo /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

`nginx -t` before every reload — it catches a typo before it becomes an outage.

## TLS

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d karta.example.se
```

Certbot rewrites the server block for port 443 and installs a renewal timer. Serve over HTTPS
even for an internal map: geolocation (the `geoposition` control) and service workers both
require a secure context, and neither will work over plain HTTP.

## Deploying under a sub-path

To serve the map at `https://example.se/karta/` rather than at a domain root, nginx alone is not
enough — Origo writes a `<base href>` from the `baseUrl` option, and the relative paths for
sprites, configuration and data resolve against it.

```nginx
location /karta/ {
    alias /var/www/origo/;
    try_files $uri $uri/ /karta/index.html;
}
```

and in `index.html`, pass the matching base:

```html
<script>
  var origo = Origo('index.json', { baseUrl: '/karta/' });
</script>
```

Mismatch here shows up as 404s for `css/svg/*.svg` and a map with no icons.

## Backend services under PM2

Only needed for server-side features — principally `sharemap` with
`storeMethod: "saveStateToServer"`. The map itself keeps being served by nginx as above; PM2
supervises the Node service beside it.

```bash
sudo npm install -g pm2
git clone https://github.com/origo-map/origo-server.git /opt/origo-server
cd /opt/origo-server && npm ci
```

Configure it per its own repository — this repository does not carry its settings. Then define
`/opt/origo-server/ecosystem.config.js`:

```js
module.exports = {
  apps: [{
    name: 'origo-server',
    script: 'index.js',
    cwd: '/opt/origo-server',
    instances: 1,
    autorestart: true,
    max_memory_restart: '500M',
    env: { NODE_ENV: 'production', PORT: 3000 }
  }]
};
```

Bind it to localhost only and let nginx be the single public entry point:

```bash
pm2 start ecosystem.config.js
pm2 save
pm2 startup systemd -u www-data --hp /var/www
```

`pm2 save` writes the current process list; `pm2 startup` prints a command to run as root that
installs the systemd unit. Without both, the service will not come back after a reboot — this is
the single most common PM2 deployment mistake.

Reverse-proxy it from the same server block:

```nginx
location /origoserver/ {
    proxy_pass http://127.0.0.1:3000/;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

Then point the control at it in `index.json`:

```json
{
  "name": "sharemap",
  "options": {
    "storeMethod": "saveStateToServer",
    "serviceEndpoint": "/origoserver/mapstate",
    "loadMapStateIdMethod": "path"
  }
}
```

`loadMapStateIdMethod` decides how a saved state is read back: `path` requests
`<serviceEndpoint>/<mapStateId>`, `query` requests `<serviceEndpoint>?mapStateId=<id>`. It has to
match what your endpoint implements. See `SHAREMAP.md` for what the stored state contains.

Useful afterwards: `pm2 status`, `pm2 logs origo-server`, `pm2 reload origo-server` (zero-downtime),
`pm2 monit`.

**If you want PM2 to serve the static files too** — `pm2 serve /var/www/origo 8080 --spa` works,
and is reasonable in a container where nginx is not present. On a normal Ubuntu host it puts a
Node process in the request path for files nginx serves better, with no compression, weaker
caching and another thing to keep alive. Prefer nginx.

## Proxying map services

Origo fetches WMS, WFS and capabilities documents from the browser, so those services must
either send permissive CORS headers or be proxied through your own origin. When you cannot
change the upstream service, proxy it:

```nginx
location /geoserver/ {
    proxy_pass https://gis.internal.example.se/geoserver/;
    proxy_set_header Host gis.internal.example.se;
}
```

and reference `/geoserver/...` in the `source` block of `index.json`. This also keeps
`connect-src 'self'` sufficient in your CSP, and hides internal hostnames from the browser.

## The service worker

`service-worker.js` is **not** copied into `build/` — the copy step does not include it. If you
want offline support, copy it into the webroot yourself:

```bash
sudo cp service-worker.js /var/www/origo/
```

and enable it in the Origo options (`serviceWorker: { url: 'service-worker.js' }`).

Understand what it does before you deploy it. It is deliberately labelled boilerplate: a
cache-first strategy over a **hardcoded asset list** with a manual `VERSION` constant (currently
`v1.0.1`). Cache-first means returning the cached copy without asking the network, so **users
keep the old application until the version string changes.** Every deploy that touches a cached
asset must bump `VERSION`, or clients will not see the update. If any asset is added or removed
from the list, bump it as well.

The `SKIP_WAITING` message handler at the bottom is what lets Origo activate a new version
without the user closing every tab. Keep it in any replacement you write.

If you do not need offline support, do not deploy the file. A stale service worker is
considerably harder to debug than a missing one.

## Updating and rolling back

Deploy releases into timestamped directories and move a symlink, so a rollback is one command
rather than a rebuild:

```bash
RELEASE=/var/www/releases/$(date +%Y%m%d%H%M%S)
sudo mkdir -p "$RELEASE"
sudo rsync -a build/ "$RELEASE/"
sudo chown -R www-data:www-data "$RELEASE"
sudo ln -sfn "$RELEASE" /var/www/origo-current
sudo nginx -t && sudo systemctl reload nginx
```

with `root /var/www/origo-current;` in the server block. Rolling back is then `ln -sfn` at the
previous directory and a reload.

Keep `index.json` out of the release directory if operators edit it in place — symlink it in
from a stable path instead, or every deploy silently reverts their configuration changes.

## Post-deploy checklist

1. `curl -I https://karta.example.se/` returns 200.
2. `curl -sH 'Accept-Encoding: gzip' -o /dev/null -w '%{size_download}\n' https://karta.example.se/js/origo.min.js`
   returns roughly 700 000, not 2 600 000 — if it returns the larger number, gzip is not applying.
3. The page source references `origo.min.js`, not `origo.js`.
4. The browser console is clean — CSP violations and missing sprites both show up here.
5. Layers draw, and the legend lists them; a blank map with no console error usually means
   `index.json` failed to parse.
6. Geolocation works, which confirms the secure context.
7. If `sharemap` uses a server: create a link, open it in a private window, and confirm the map
   restores.
8. If the service worker is deployed: reload twice and confirm you get the version you just
   shipped, not the previous one.
