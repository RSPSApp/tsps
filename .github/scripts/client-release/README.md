# Shared web client releases

The **Client release** workflow builds and publishes shared web-client bundles.
It does not build desktop applications, generate installers or require Apple credentials.

Pushes to `main` that change the client or release tooling publish automatically.
Merged PRs are covered by that push; closing an unmerged PR does not publish.
PRs run the build and checks without access to signing credentials.

Automatic releases increment the highest existing stable `client-vX.Y.Z` release's
patch version, starting at `0.1.1`. Draft releases reserve their version too.
Manual dispatch on `main` accepts an explicit newer stable version for a major or
minor release; leave it blank for the next patch. Releases are serialized to avoid
version races. GitHub may coalesce pending runs during rapid pushes.

The build job checks the client, prepares its active game cache for compilation,
and produces generic web assets without owner-specific configuration. The signed
update archive includes `caches/caches.json` to pin the matching cache selection,
while excluding game cache data and launcher branding. Desktop clients reuse the
browser's cache loader, fetching versioned data from `https://rsps.app/play/caches/`
and retaining it locally. Browser loading stays unchanged. `REACT_APP_CACHE_BASE_URL`
can move data to a CDN in a future web-client release without rebuilding wrappers;
desktop cache selection still comes from the installed release's `caches.json`.

A separate publishing job uses the existing `production` environment, restricted
to `main`. It signs the manifest, uploads the archive, manifest and detached
signature to a draft release, then marks the complete release as latest. Build
artifacts expire after one day. Published release assets remain available.

## Signing and installed clients

`CLIENT_UPDATE_SIGNING_KEY` in the `production` environment contains the Tauri
update-signing private key; `CLIENT_UPDATE_SIGNING_KEY_PASSWORD` is optional.
The matching public verification key is in `client-update.pub`. Private keys must
never be committed. Keep a protected backup: installed clients trust this key.

Installed clients use this feed:

```
https://github.com/RSPSApp/tsps/releases/latest/download/manifest.json
```

Archives use immutable `client-v<version>` URLs. Keep other release types from
replacing this repository's latest-release pointer. Do not overwrite published
versions. The manifest's `minShellVersion` is the minimum installed native wrapper
version (currently `0.1.1`); raise it when updated web files require new native APIs.

## Local checks and packaging

```
npm ci --prefix .github/scripts/client-release
npm test --prefix .github/scripts/client-release
npm run build:web --prefix .github/scripts/client-release
```

After building, package and sign locally with a matching private key outside the
repo:

```
export TAURI_SIGNING_PRIVATE_KEY_PATH=/path/to/private.key
npm --prefix .github/scripts/client-release run release:web -- 0.1.2 https://example.com/client-v0.1.2/
```

Output is under `.github/scripts/client-release/releases/client/`: `client-<version>.tar.gz`,
`manifest.json`, and `manifest.json.minisig`. Tauri's wrapped `.sig` is also retained
locally, but the updater consumes the raw `.minisig` detached signature.
