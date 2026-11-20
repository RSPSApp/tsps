# Desktop integration in shared web-client releases

The native wrapper injects `window.__RSPS_DESKTOP_PROFILE__` before loading the
web client. The profile uses the existing `ConfiguredServer` shape: name, address,
secure, maxPlayers and optional WebRTC transport/signalUrl/worldId/iceServers.
The desktop client starts on that configured world every launch; players can
still switch worlds within the session. Browser clients without a profile keep
restoring their saved world and existing deep links.

After cache and renderer initialization, the desktop client acknowledges startup
through `plugin:hot-update|notify_app_ready`. Failed initialization is not
acknowledged. The wrapper owns activation/rollback and the desktop skips browser
service-worker registration. Browser registration stays unchanged.

## Cache data and release pinning

There is one cache loader. Desktop clients use the same range requests, full-load
fallback, persistence and progress UI as browser clients. Desktop cache data comes
from `https://rsps.app/play/caches/`, while each signed release contains its own
`caches/caches.json` naming the matching immutable cache directory/revision. A
rollback restores that older cache selection. Cache data is not bundled in web
releases. Missing hosted data produces the existing startup failure, rather than
silently selecting the latest cache.

`REACT_APP_CACHE_BASE_URL` overrides the data location at web-client build time,
so a CDN change can ship as a web release without a native-wrapper update.
Desktop still reads the release's local `caches.json`. Browser cache URLs,
metadata selection and on-demand loading remain unchanged. On custom-scheme
WebKit origins, the existing IndexedDB fallback replaces unsupported CacheStorage.

This PR contains the TSPS/web-client side only. Native installers must inject the
profile and implement the acknowledgement command; installer generation, signing
and `/host` download controls are separate.

## Required client version

`/api/world-info` advertises one `clientVersion` identifier. Server builds and web
releases derive it from the same workflow inputs using `scripts/client-version.mjs`.
Server-only changes keep the same identifier. The generated server module is
compiled into the runtime, including browser-host snapshots, so older running
worlds keep their own requirement without consulting a global latest pointer.

The build produces `desktop-bootstrap.js` for native installers. It is excluded
from OTA game archives so the asset provider cannot replace the launcher while
selecting a game version. The wrapper embeds it in its startup page, independently of
the active game bundle. It calls `window.__RSPS_DESKTOP_BOOTSTRAP__.manifestUrl(profile)`
to read world-info over HTTP or the existing pre-login WebRTC content channel.
That returns only the exact immutable TSPS release URL. The wrapper verifies the
signed manifest with its trusted key, uses its cached matching bundle or downloads
that release, and only then opens the game. Never fall back to the latest release.
A world without version metadata or a failed lookup must show an error and must
not cause an update. Do not acknowledge an incompatible bundle as a successful boot.

Each bundle carries `client-release.json` with its identifier. Desktop startup and
login compare it with the selected world's requirement. Incompatible in-game
world switches are blocked with a message; they do not automatically swap game
bundles. Browser clients do not perform this desktop check. The wrapper's minimum
version is now 0.1.2; older latest-only launchers must be upgraded first.
