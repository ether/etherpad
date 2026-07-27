# Deployment

This page collects working configurations for deploying Etherpad in production:
running it behind a reverse proxy, hosting it under a subdirectory, terminating
HTTPS natively, running it as a system service, and deploying it on Kubernetes.

Etherpad listens on port `9001` by default. Throughout this page the upstream
Etherpad server is assumed to be reachable at `http://127.0.0.1:9001`.

## Running behind a reverse proxy

The recommended production setup is to run Etherpad on `127.0.0.1:9001` and put a
reverse proxy in front of it to terminate TLS, serve a virtual host, and forward
requests.

Etherpad uses WebSockets (via socket.io). The load-bearing part of every proxy
config below is the WebSocket upgrade: the proxy **must** forward the `Upgrade`
and `Connection` headers, or real-time editing will silently fail back to slow
long-polling (or break entirely).

When Etherpad runs behind a proxy you should also set `trustProxy: true` in your
settings so that Etherpad honours the `X-Forwarded-*` headers (correct client IP,
secure-cookie flag, etc.). See the `trustProxy` section in the [Configuration documentation](./configuration.md) for the full details of which headers are trusted.

### Nginx

```nginx
# Map the Upgrade header so WebSockets work. Place this in the http context.
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    listen      443 ssl;
    listen      [::]:443 ssl;
    server_name pad.example.com;

    ssl_certificate     /etc/nginx/ssl/etherpad.crt;
    ssl_certificate_key /etc/nginx/ssl/etherpad.key;

    location / {
        proxy_pass         http://127.0.0.1:9001;
        proxy_buffering    off;
        proxy_set_header   Host $host;
        proxy_pass_header  Server;

        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;

        # WebSocket support
        proxy_http_version 1.1;
        proxy_set_header   Upgrade $http_upgrade;
        proxy_set_header   Connection $connection_upgrade;
    }
}

# Redirect plain HTTP to HTTPS
server {
    listen      80;
    listen      [::]:80;
    server_name pad.example.com;
    return 301  https://$host$request_uri;
}
```

### Apache

Enable `mod_proxy`, `mod_proxy_http`, `mod_proxy_wstunnel` and `mod_headers`.
The `mod_proxy_wstunnel` `upgrade=websocket` syntax requires Apache 2.4.47 or
newer.

```apache
<VirtualHost *:443>
    ServerName pad.example.com

    SSLEngine on
    SSLCertificateFile    /etc/ssl/etherpad/etherpad.crt
    SSLCertificateKeyFile /etc/ssl/etherpad/etherpad.key

    ProxyVia On
    ProxyRequests Off
    ProxyPreserveHost On

    # WebSocket traffic (socket.io) must be matched first.
    <Location "/socket.io">
        ProxyPass        "ws://127.0.0.1:9001/socket.io" upgrade=websocket timeout=30
        ProxyPassReverse "ws://127.0.0.1:9001/socket.io"
    </Location>

    <Location "/">
        ProxyPass        "http://127.0.0.1:9001/" retry=0 timeout=30
        ProxyPassReverse "http://127.0.0.1:9001/"
    </Location>
</VirtualHost>
```

### Caddy

Caddy v2 proxies WebSocket connections automatically and obtains/renews a
certificate for you, so the configuration is minimal:

```caddy
pad.example.com {
    reverse_proxy 127.0.0.1:9001
}
```

### Traefik

Traefik v2 also proxies WebSockets transparently. For a Docker deployment, attach
these labels to the Etherpad container:

```yaml
labels:
  - "traefik.enable=true"
  - "traefik.http.routers.etherpad.rule=Host(`pad.example.com`)"
  - "traefik.http.routers.etherpad.entrypoints=websecure"
  - "traefik.http.routers.etherpad.tls.certresolver=myresolver"
  - "traefik.http.services.etherpad.loadbalancer.server.port=9001"
  - "traefik.http.services.etherpad.loadbalancer.passhostheader=true"
```

### HAProxy

HAProxy detects the `Connection: Upgrade` exchange automatically and switches to
tunnel mode once the WebSocket is established. The important value is
`timeout tunnel`, which governs the lifetime of the upgraded connection.

```haproxy
frontend http
    mode http
    bind *:80
    bind *:443 ssl crt /etc/haproxy/certs/etherpad.pem alpn h2,http/1.1
    http-request redirect scheme https code 301 unless { ssl_fc }
    http-request add-header X-Forwarded-Proto https if { ssl_fc }
    default_backend etherpad

backend etherpad
    mode http
    option forwardfor
    timeout client  25s
    timeout server  25s
    timeout tunnel  3600s
    server pad 127.0.0.1:9001
```

## Hosting under a subdirectory

To serve Etherpad from a path such as `https://example.com/pad` rather than from
the root of a domain, the proxy must send the `X-Proxy-Path` header so that
Etherpad rewrites its own asset and API URLs to include the prefix. This header
is honoured regardless of the `trustProxy` setting — see the [Configuration documentation](./configuration.md).

```nginx
location /pad/ {
    rewrite           ^/pad/(.*)$ /$1 break;
    proxy_pass        http://127.0.0.1:9001;
    proxy_buffering   off;
    proxy_set_header  Host $host;
    proxy_set_header  X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header  X-Proxy-Path /pad;

    # WebSocket support
    proxy_http_version 1.1;
    proxy_set_header   Upgrade $http_upgrade;
    proxy_set_header   Connection $connection_upgrade;
}
```

## Native HTTPS without a proxy

Etherpad can terminate TLS itself using Node's native HTTPS server, with no
reverse proxy required. Configure the `ssl` block in `settings.json`:

```json
"ssl": {
  "key":  "/path-to-your/etherpad-server.key",
  "cert": "/path-to-your/etherpad-server.crt",
  "ca":   ["/path-to-your/intermediate-cert1.crt", "/path-to-your/intermediate-cert2.crt"]
}
```

* `key` — path to the private key file.
* `cert` — path to the certificate file.
* `ca` — an (optional) array of intermediate/chain certificate paths.

Restart Etherpad after editing the settings. It will now serve HTTPS on its
configured port.

For local testing you can generate a self-signed certificate with a single
command:

```bash
openssl req -x509 -newkey rsa:4096 -nodes -days 365 \
  -keyout etherpad-server.key -out etherpad-server.crt \
  -subj "/CN=localhost"
```

Make sure the files are readable only by the user that runs Etherpad:

```bash
chmod 400 etherpad-server.key etherpad-server.crt
chown etherpad etherpad-server.key etherpad-server.crt
```

::: tip
Self-signed certificates trigger browser warnings and are only suitable for
testing. For production, obtain a free, trusted certificate from
[Let's Encrypt](https://letsencrypt.org/), or terminate TLS at a reverse proxy
(see above) and let it manage certificate issuance and renewal.
:::

## Running as a service (systemd)

On a modern Linux distribution, run Etherpad as a `systemd` service so it starts
on boot and restarts automatically on failure.

Create a dedicated unprivileged user and install Etherpad into its home
directory (for example `/opt/etherpad`), owned by that user. Etherpad refuses to
start as root.

Create `/etc/systemd/system/etherpad.service`:

```ini
[Unit]
Description=Etherpad collaborative editor
After=network.target

[Service]
Type=simple
User=etherpad
Group=etherpad
WorkingDirectory=/opt/etherpad
Environment=NODE_ENV=production
ExecStart=/usr/bin/pnpm run prod
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Adjust `WorkingDirectory` to your install path and the `ExecStart` path to
wherever `pnpm` lives (`which pnpm`). Then enable and start the service:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now etherpad.service

# check status and follow logs
sudo systemctl status etherpad.service
sudo journalctl -u etherpad.service -f
```

## Kubernetes (Istio)

The following manifest deploys Etherpad behind an Istio ingress gateway. It
defines three resources: a `Gateway` (TLS + hostname), a `VirtualService`
(routing with WebSocket-friendly timeouts), and a `DestinationRule` (sticky
sessions via the socket.io `io` cookie).

It assumes:

* Istio >= 1.18
* A `Service` named `etherpad` in the `etherpad` namespace, on port `9001`
* A TLS secret `etherpad-tls` provisioned in the gateway namespace
* You replace `<your-host>` with your own hostname

::: warning
Sticky sessions are necessary but **not** sufficient for a multi-replica
Etherpad deployment. Multi-replica also needs the socket.io Redis adapter so
that pad state is shared across pods. Without it, two clients editing the same
pad but routed to different pods will see divergent state.

Recommendation: start with `replicas: 1` plus good failover, and only go
multi-replica once the Redis adapter is wired up.
:::

```yaml
apiVersion: networking.istio.io/v1beta1
kind: Gateway
metadata:
  name: etherpad
  namespace: etherpad
spec:
  selector:
    istio: ingressgateway
  servers:
    - port:
        number: 443
        name: https
        protocol: HTTPS
      tls:
        mode: SIMPLE
        credentialName: etherpad-tls
      hosts:
        - <your-host>
    - port:
        number: 80
        name: http
        protocol: HTTP
      hosts:
        - <your-host>
      tls:
        httpsRedirect: true

---
apiVersion: networking.istio.io/v1beta1
kind: VirtualService
metadata:
  name: etherpad
  namespace: etherpad
spec:
  hosts:
    - <your-host>
  gateways:
    - etherpad
  http:
    - match:
        - uri:
            prefix: /
      route:
        - destination:
            host: etherpad
            port:
              number: 9001
      # No per-request timeout — websockets and long-polling sit on the
      # connection indefinitely. The default of 15s kills WS upgrades.
      timeout: 0s

---
apiVersion: networking.istio.io/v1beta1
kind: DestinationRule
metadata:
  name: etherpad
  namespace: etherpad
spec:
  host: etherpad
  trafficPolicy:
    loadBalancer:
      # Sticky sessions on the socket.io session cookie. Required so that
      # long-polling fallback requests land on the same pod that owns the
      # session state.
      consistentHash:
        httpCookie:
          name: io
          ttl: 0s   # session cookie, expires with the browser tab
    connectionPool:
      tcp:
        maxConnections: 10000
      http:
        # Must comfortably exceed socket.io's pingInterval (25s) +
        # pingTimeout (20s). 1h is conservative.
        idleTimeout: 3600s
        h2UpgradePolicy: UPGRADE
        http1MaxPendingRequests: 1000
```
