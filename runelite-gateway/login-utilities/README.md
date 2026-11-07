# Login Utilities (experimental)

Optional remembered-account login for the native RuneLite client connected through the TSPS gateway. It uses the original username/password form and native **Play Now** screen, with no separate login window or replacement artwork.

The integration is disabled by default. Ordinary gateway password login continues to work without this plugin or its HTTP endpoint.

## Components and supported clients

- The gateway's loopback-only login broker authenticates against TSPS's existing login protocol. TSPS issues/rotates the same 30-day remembered tokens used by the browser client; account saves retain their hashes rather than plaintext tokens.
- The RuneLite plugin stores the returned token through a standalone Windows CurrentUser DPAPI helper. Passwords are used transiently for first sign-in and are not saved by the plugin/helper.
- A single-use native login ticket transfers the already-authenticated TSPS connection to the gateway. This avoids a second authentication consuming the newly rotated token. An unclaimed ticket expires after 45 seconds and releases its connection.

The native compatibility adapter is tested with RuneLite **1.13.4**, the RSProx-injected revision **241** client, and Windows **10/11**. It resolves the injected client's semantic wrappers rather than hardcoding obfuscated field names. Unsupported layouts leave ordinary login available. Other revisions require testing and may need adapter changes.

Token storage initially supports **Windows only**. On other operating systems the plugin leaves ordinary password login available; there is no plaintext-password/token fallback.

## Host setup

1. Build the RuneLite Gateway with Login Utilities support.
2. Set `GATEWAY_LOGIN_HTTP_PORT=3188` (or another unused local port) for the gateway process. Its default is `0`, which disables the broker. Only one gateway process may own this port.
3. Publish `/login-utilities/v1/session` through a reverse proxy on your own **HTTPS** hostname. The broker itself binds only to `127.0.0.1` and must not be exposed directly.
4. Replace `X-Real-IP` with the actual incoming peer address at the trusted proxy. Do not forward a client-supplied value unchanged. For example, inside an existing Caddy HTTPS site:

```caddyfile
handle /login-utilities/v1/session {
    request_body {
        max_size 4KB
    }
    reverse_proxy 127.0.0.1:3188 {
        header_up X-Real-IP {remote_host}
    }
}
```

Requests are POST-only, size-limited and rate-limited. Browser `Origin` requests are rejected; this is a native client endpoint, not a replacement web login page. Responses must not be cached, and reverse proxies must not log request/response bodies.

Tickets normally require the same username and peer address as the HTTPS login. **Only** if native connections arrive through a trusted local TCP forwarding service, set `GATEWAY_LOGIN_TRUST_LOOPBACK_PROXY=true`. This permits a loopback native peer to redeem the ticket without matching its original public address. The ticket remains random, single-use, expiring and username-bound. Leave this setting false for direct native connections.

## Build the client components

From the repository root, with JDK 17 installed:

```sh
runelite-gateway/gradlew -p runelite-gateway/login-utilities clean test jar
```

Output: `runelite-gateway/login-utilities/build/libs/LoginUtilities.jar`. The build pins the RuneLite compile dependency and ASM version, uses reproducible JAR ordering/timestamps, and bundles ASM but not RuneLite itself. Dependency license metadata is retained.

On Windows, build and test the separate storage helper:

```powershell
./runelite-gateway/login-utilities/token-store/build.ps1
./runelite-gateway/login-utilities/token-store/test.ps1
```

Output: `runelite-gateway/login-utilities/token-store/LoginUtilities.TokenStore.exe`. The script uses Windows' .NET Framework C# compiler; no custom launcher or server-specific executable is required. Binaries are build outputs, not committed source files.

Hosts can distribute the plugin/helper through their existing launcher update process. Update **both** files when their protocol changes. This contribution does not provide a universal installer or auto-updater.

## Provision a dedicated RuneLite profile

Use a **separate RuneLite/RSProx profile for this server**. An explicitly configured loopback host/world number identifies that dedicated profile; it cannot distinguish unrelated proxy targets sharing the same local host/world. Do not reuse the profile for another server or official OSRS.

1. Put `LoginUtilities.jar` in the profile's supported `sideloaded-plugins` directory. Sideloading must be enabled by the host's RuneLite distribution.
2. Install the storage helper at an absolute local path.
3. Copy `host.properties.example` to `<RuneLite user.home>/.login-utilities/host.properties`. Set your HTTPS endpoint, world number, exact client-facing world hosts, helper path, and `enabled=true`. Use forward slashes in Windows property paths.
4. In RuneLite's **Login Utilities** plugin settings, enable **Remember account**. It defaults to off.

Missing/disabled/invalid host configuration does not intercept login. HTTPS redirects are not followed, and credentials are only submitted for the configured world/host. Server addresses are supplied by the profile configuration; none are hardcoded into the plugin.

Sign in through the original username/password form, then click native **Play Now**. Later logins and client launches can use Play Now without entering the password again. Finish the initial login before its 45-second ticket expires; a new account has no persisted token until it first enters the world.

Log out before switching accounts. **Forget account**, or disabling **Remember account**, removes this profile/server's local token and restores the ordinary login screen. Forgetting is local deletion; a password change revokes server-side remembered sessions. Explicit invalid-token rejection returns to password login. Temporary errors such as an account still logging out do not erase saved credentials.

The helper stores each server/profile namespace separately under `%LOCALAPPDATA%/TSPS/LoginUtilities/<scope>/login-token.bin`. The scope is derived from endpoint and configured world identity, and participates in DPAPI entropy. Changing the host configuration does not migrate a token to the new server. Secrets travel to/from the helper only through redirected pipes; the command line contains only an operation and nonsecret namespace hash.

## Validation

The gateway tests cover password and rotating-token handoff into the native world, one-use tickets, username/address binding, explicit trusted-loopback forwarding, expiry, and invalid requests. Start an isolated TSPS worktree before running its integration tests; without a server, live integration cases are skipped.

```sh
runelite-gateway/gradlew -p runelite-gateway test --tests gateway.login.LoginBrokerTest --tests gateway.it.M1LoginTest
```

The standalone plugin tests check HTTPS restrictions, host matching, disabled configuration, and server namespace isolation. Windows helper tests cover DPAPI round trips, cross-server copy rejection, modified ciphertext, malformed inputs and local forgetting. A full native-client test should additionally cover first login, logout/relogin in the same process, client relaunch, temporary failures and expired tokens on each host's actual RSProx build.
