# Instance Console v1 — implementation contract

Status: design/foundation only. No interactive console is deployed by this change.

## Goal
Provide an interactive browser terminal for RUNNING, REAL, managed Incus containers, available from the admin instance detail and the owning customer portal. Preserve the current Node.js 24 / NestJS / Next.js / Docker Compose / PostgreSQL stack and the separate management VPS / Incus node trust boundary.

## Incus transport
Use the Incus `POST /1.0/instances/{name}/exec` operation with `interactive:true`, `wait-for-websocket:true`, a PTY and a fixed shell command. The resulting `/1.0/operations/{uuid}/websocket?secret=...` websocket(s) MUST be opened by the trusted per-node worker (mTLS), never by the user's browser. An interactive exec terminal is not the same as the serial/VGA console. Support container terminal first; virtual-machine console remains a future adapter. Follow the official Incus REST API spec for exec websocket and control stream semantics.

## Trust boundaries
1. Browser authenticates only to KIIRO-HOST (existing session cookie, TLS, same-origin); never receives Incus URLs, operation secrets, client certificates or private keys.
2. API checks the authenticated actor on *every* session request: admin role or customer.owner; instance is not deleted; provider INCUS; metadata mode REAL and provisioning INCUS; name matches `^kh-[a-z0-9-]{1,60}$`; node ONLINE and heartbeat fresh; instance status RUNNING; no active destructive task.
3. API grants a short-lived, single-use, random console ticket bound to actor, instance, node, session and client role. Store only a hash of the ticket with a short TTL; atomically consume it. Do not put the ticket in query strings, URLs, cookies or application logs. A new ticket must be issued per connection; reconnect reauthorizes.
4. An authenticated same-origin WebSocket gateway validates Origin, session and one-use ticket before granting access. Do not trust user-provided instance name or node endpoint. Apply strict concurrent-session counts per user/instance, maximum startup timeout, idle timeout, absolute session duration and per-message payload limits.
5. Gateway connects to the *pinned* per-node Incus worker over an authenticated private broker channel. Worker resolves the instance from validated server-side data, establishes pinned Incus mTLS and exec PTY websockets. Never expose Incus port 8443 publicly or from the browser.
6. Console has access equivalent to the configured shell user (container root in v1). Warn clearly in UI: anyone using console can change/destroy guest data. Do not log keystrokes or guest output. Audit metadata only: actor, instance, node, session-open/close, duration, reason. Scrub secrets from logs/errors.
7. Server and worker close the Incus exec/websocket on disconnect, revoke or timeout. Rate-limit handshakes, inputs, output bytes and concurrent sessions; backpressure to avoid OOM. Never automatically restart stopped instances for console use.
8. Force a separate explicit action to open console; no SSH password entry or secret injection. Ensure CSP / secure WebSocket upgrades in reverse proxy, and test authentication and authorization on both ordinary HTTP and upgrade paths.

## Proposed delivery increments
- **A: Backend security/eligibility**: add shared console policy and audit events; test admin, owner, cross-customer, stopped, deleted, offline/stale node, pending DELETE, invalid identity, and session expiry.
- **B: Private session broker**: add authenticated gateway and worker protocol with bounded, one-time tickets; implement Incus exec PTY websocket via pinned node client; heartbeat and lifecycle close semantics.
- **C: Frontend terminal**: add `/admin/instances/[id]/console` and owning customer's console route, dynamically load an xterm-compatible terminal, keyboard support, Unicode, copy/paste, resize and reconnect UX. Hide terminal when the backend capability isn't enabled.
- **D: Release**: opt-in flag default OFF; dedicated CI for auth/upgrade/expiry/backpressure; deploy gateway and worker without touching Postgres/Redis volumes; enable on test node only; verify against an existing non-production container, then expand.

## Acceptance criteria
- Admin and *owning* customer can open shell and execute `id`, `uname -a` and `ip addr` without knowing root password.
- Another customer's session, forged instance ID, expired ticket, replayed ticket, wrong Origin, stale node or stopped VPS are denied before a worker starts exec.
- A client disconnect terminates the guest exec. No dangling Incus sessions after expiry or manual revoke.
- Host/node SSH administration is never available from the browser, and console cannot target the management VPS.
- No guest output/keystrokes/passwords/TLS keys in logs or DB; IPAM and task lifecycle unchanged.
- No automatic PROD rollout until integration tests and manual snapshot of management VPS.

## Current code milestone after foundation
The API implements `GET /api/compute/{instances|customer/instances}/:id/console/availability` (no remote access) and adds opt-in `POST .../:id/console/ticket` issuance. Tickets are 32-byte cryptographically random, stored in Redis as SHA-256 hashes, 30-second TTL, single-use via Redis GETDEL, and rate-limited to one issuance per session and instance every five seconds. Issuance validates login session, admin/owner scope, eligible managed RUNNING instance and explicitly allowed HTTPS Origin. `CONSOLE_TICKETS_ENABLED` is OFF unless set to `true`; do not enable it until the gateway validates and consumes tickets. `CONSOLE_ALLOWED_ORIGINS` must contain explicit production HTTPS origins when rollout begins.

**Not yet implemented**: trusted private gateway, browser WS handshake, Incus exec PTY websocket bridge, cleanup on disconnect, and usable frontend terminal. The gateway MUST independently revalidate the claimed session, instance state and ownership after consuming the ticket. No console is exposed by these changes.

## Incus PTY protocol milestone (worker-side only)
- `apps/worker/src/incus-console-protocol.ts` validates a managed instance name, strict local operation UUID path, the terminal `fds.0` and `fds.control` secrets, and bounded terminal dimensions. Resize messages use `{"command":"window-resize","args":{"width":"80","height":"24"}}`.
- `IncusClient.prepareConsoleExec` performs a fixed `/bin/sh` interactive exec request with `wait-for-websocket:true`, `record-output:false`, pinned node TLS, and verifies channel metadata. It MUST only be invoked by a separately authenticated private worker broker after ticket consumption plus fresh DB eligibility validation. The method is currently **not called** by any running component.
- Unit tests cover valid/invalid metadata, untrusted operation paths, targets and resize frames. No interactive WebSocket bridge, session lifecycle, revocation, rate/backpressure enforcement or browser terminal exists yet.
- **Security release gate:** Do not wire this method to an HTTP endpoint, do not log/return its secrets or expose Incus host credentials. Feature flag remains off in production. Dedicated integration acceptance testing is required before enabling.

## Gateway authorization milestone (private helper)
- `authorizeConsoleGateway(ticket, sessionToken, prisma, sessions)` is a private **unexposed** authorization step intended for an authenticated same-origin WS upgrade handler. It first authenticates the supplied existing session, then atomically consumes the short-lived Redis ticket.
- After ticket consumption it reads the current instance, owner record and any active task from the database; rejects mismatched session/user/role, ID/node/name, non-owner customer, deleted or stopped instances, stale/offline/unmanaged nodes, and active work.
- `consoleClaimsMatchActor` and `consoleAvailability` have dedicated tests. Authorization must be repeated during long-running sessions; gateway must check Origin **before** calling this function and must not send credential/session/ticket values to a worker.
- **Not deployed:** The actual websocket server, per-node private broker, interactive PTY bridge, and frontend terminal remain to be implemented. Do not set `CONSOLE_TICKETS_ENABLED=true` on Production.

## Authenticated WebSocket ingress milestone (NO PTY bridge yet)
- The Nest HTTP server registers an optional `/api/console/ws` upgrade listener only if `CONSOLE_WS_ENABLED=true`. The production default is OFF.
- Strict `Origin` allowlist, same-origin fetch-site, exact pathname (without query parameters), existing session cookie, and size-limited first JSON `{type:"authenticate",ticket:"..."}` authentication frame.
- One-use Redis ticket is redeemed only by calling `authorizeConsoleGateway`, which revalidates actor session, DB ownership, node freshness and task status. The ticket never travels in query strings or subprotocols.
- Auth handshakes have a five-second timeout, limited frame size, no per-message compression; failed handshakes do not reveal internal auth details.
- **This is not a working terminal.** After a valid handshake the gateway explicitly sends `CONSOLE_BRIDGE_NOT_CONFIGURED` and closes the socket. Never claim the shell is connected, and never enable `CONSOLE_WS_ENABLED` or `CONSOLE_TICKETS_ENABLED` in Production until the private worker channel, stream bridge, lifecycle controls and terminal frontend are complete.
- Deployment requires a trusted reverse-proxy WS route to the API service. Next.js `/api/backend` is an HTTP-only fetch proxy and does not support WS Upgrade. TLS/WSS must terminate at the outer reverse proxy; the API is bound to loopback and must remain unexposed to the internet.
