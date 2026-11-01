# RuneLite demo for an isolated TSPS world

Run genuine RuneLite 1.13.3 (native revision 241) against an isolated TSPS world. A local RSProt JVM gateway translates RuneLite's TCP protocol into TSPS's existing WebSocket protocol. TSPS remains authoritative for authentication, gameplay and persistence.

**Scope: a working, single-client local demo.** It demonstrates native login, walking, chat, logout/relog and optional server branding. This guide is for developers reviewing that demo on Windows. It is not a player release or a remote-server connection guide.

**117 HD is optional.** Normal preparation and launch do not require or download it. Run the standard demo first; add HD separately if wanted.

## Prerequisites

- A working TSPS checkout, Node 22+, PowerShell 7 and Git Bash for the repository's worktree script.
- JDK 21; set `JAVA_HOME` to its installation directory in each PowerShell terminal, or pass `-JavaHome` to the PowerShell scripts.
- The revision 241 cache `server/caches/osrs-241_2026-10-20`, including its map keys. The worktree helper copies the cache and dependencies from your existing checkout. Run normal repository setup if these are missing.
- Internet access on first preparation/build for pinned RuneLite, RSProx, Gradle and Maven artifacts. Downloaded/patched binaries are stored locally, not included in this PR.

## Create an isolated worktree

From your normal TSPS checkout in Git Bash:

```bash
git fetch https://github.com/UnhealthyKraken/tsps.git feat/runelite-gateway
gateway_commit=$(git rev-parse FETCH_HEAD)
scripts/wt new test/runelite-gateway "$gateway_commit"
cd ../tsps-test-runelite-gateway
```

The immutable commit is captured before the helper fetches upstream. Use a fresh test branch name if `test/runelite-gateway` already exists.

`scripts/wt` assigns a slot and private ports in `.env`. Its copied cache, dependencies and separate `server/data` keep this experiment away from your installed world. Use a new account here. Do not copy or link your live player database into it.

Open three PowerShell terminals in the new worktree. In the gateway and client terminals, calculate the assigned ports:

```powershell
$slot = [int](Select-String -Path .env -Pattern '^WT_SLOT=(\d+)$').Matches.Groups[1].Value
$wsPort = 43700 + $slot
$gamePort = 43800 + $slot
$httpPort = 43900 + $slot
```

## Start TSPS

First terminal:

```powershell
# Build once when server source changed or dist is absent:
node server/node_modules/typescript/bin/tsc --build server
node tools/runelite-gateway/serve-tsps.cjs
```

The launcher enables the opt-in snapshot plugin, forces worktree-local SQLite/legacy paths and disables legacy import. It refuses an installed main checkout, inconsistent slot, external save links or an occupied game port. It never stops an existing process. `--check` prints the resolved setup without starting the server.

## Start the gateway

Second terminal, with `JAVA_HOME` and the calculated ports:

```powershell
./tools/runelite-gateway/start.ps1 -Build -Port $gamePort -HttpPort $httpPort -Upstream "ws://127.0.0.1:$wsPort"
```

`-Build` is needed initially or after gateway source changes. Subsequent unchanged launches can omit it. TCP and HTTP bind loopback only. The gateway reads this worktree's copied cache and creates a disposable local RSA key; it never opens player saves. Default/live ports 43594/3000/49700 are rejected.

## Prepare a disposable demo account

First-time character creation and Tutorial Island are outside the native demo. Use an account already prepared in **this isolated world**, or prepare one through its ordinary browser client before opening RuneLite.

Temporarily use the third terminal for the browser client, from the worktree root:

```powershell
yarn --cwd client start
```

Open the worktree client URL (`http://localhost:<3100 + slot>`; slot20 is `http://localhost:3120`). Check the branch/world shown on its login screen. Create a disposable local account, confirm its character appearance and answer the experience prompt. Talk to the Gielinor Guide and choose to skip Tutorial Island; choose **No, thanks** at the Ironman prompt for an ordinary demo character. Finish the welcome dialogue in the ordinary world, then log out normally and close that browser tab. Stop only this browser development process with Ctrl+C; leave the isolated TSPS server running. Reuse the third terminal for RuneLite below.

Do not use a live account/save or start another game server for this step. On subsequent runs, use the same prepared test account; account setup is not part of the native walkthrough.

## Prepare and open RuneLite

Third terminal, with `JAVA_HOME` and the calculated ports:

```powershell
./tools/runelite-client/prepare.ps1
./tools/runelite-client/start.ps1 -RsaModulusFile tools/runelite-gateway/.runtime/rsa-modulus.txt -GamePort $gamePort -HttpPort $httpPort
```

Preparation verifies artifact sizes/hashes and the actual injected client revision. Launch patches only these local copies with the gateway's RSA/ports/host and uses a separate client home, cache, configuration and OS environment under `tools/runelite-client/.runtime`. It does not change an installed RuneLite profile. The launcher refuses another client using this private runtime.

Log in with the prepared disposable account from this isolated world. Select **All** or **Public** at the bottom to see public messages; a Game-only chat view can persist between sessions.

### Walk through the demo

1. In the patched RuneLite window, select **Existing User** and enter the prepared test account's username and password. These are local TSPS credentials. An unused name starts unsupported first-time onboarding instead of this demo flow.
2. Confirm that the welcome screen has a black backdrop, then click **Click here to play** to reveal the world.
3. Click the ground, then the minimap, and confirm that the character moves. Keep the demonstration in the ordinary world near the starting area.
4. Select **All** or **Public**, type three short messages and press Enter after each. Each message should appear once. A moderator crown appears before the name only if the test account has that rank.
5. Open the game's logout tab and click **Click here to logout**. Log in again with the same test account, click Play and confirm the saved position.
6. Log out normally and close RuneLite before stopping the demo services as described below.

Inventory/wielding and NPC Talk-to/Continue also have native QA evidence. The sword, coins and NPC in the screenshots were controlled test fixtures; this walkthrough does not provision them or claim item acquisition works. To demonstrate owner branding, configure the three optional fields below before starting the gateway and client, then repeat login/Play/logout.

### Demo boundaries

- Only one native client can connect at a time; a second connection is rejected. Normal logout/relog works; automatic native reconnect is not implemented.
- First-time character design and tutorial completion require the isolated browser client as described above. The native walkthrough starts with a prepared account in the ordinary world.
- Ground items, dynamic object changes, shops/trade, targeted item/spell actions, inventory/bank dragging, private/social state, projectiles/audio and instances/Sailing are outside this demo's acceptance scope. Several of these packet paths are absent, not merely untested.
- Generic bank/inventory packets and widget clicks have mappings, but that does not establish complete banking, shopping, combat or skilling support. Keep the walkthrough to the demonstrated actions above.
- The listeners and advertised world are local only. The scripts intentionally protect the running installation and use separate worktree data; do not repoint this demo at a live world.

### Optional 117 HD

Close the client normally, then in the client terminal:

```powershell
./tools/runelite-client/prepare.ps1 -HD
./tools/runelite-client/start.ps1 -RsaModulusFile tools/runelite-gateway/.runtime/rsa-modulus.txt -GamePort $gamePort -HttpPort $httpPort -HD
```

Enable **117 HD** in RuneLite's configuration list on first use. Core GPU and 117 HD are mutually exclusive; RuneLite may require switching from GPU through this toggle. The renderer is pinned to 117 HD 1.6.0, verified against the signed RuneLite 1.13.3 Plugin Hub manifest. Omit `-HD` to use the standard client again.

## Server branding (optional)

Server owners can independently replace the middle welcome-screen banner, the bottom parchment text, and the username/password screen's background. This works with the standard client; 117 HD is not involved.

Copy the template and edit the local copy:

```powershell
Copy-Item tools/runelite-gateway/branding.example.json tools/runelite-gateway/branding.local.json
```

The template uses `null` for all three settings, preserving the stock screen. For example, after adding your images:

```json
{
  "welcomeText": "Welcome to our server!\nNews and events: discord.gg/example",
  "welcomeBanner": "branding-assets/welcome-banner.png",
  "loginBackground": "branding-assets/login-background.jpg"
}
```

- Paths are relative to the JSON file. Place the example images under `tools/runelite-gateway/branding-assets/`. The local config and this asset directory are ignored by Git.
- Use PNG or JPEG, at most 8 MiB per image, with each dimension at most 4096 pixels. Files and links must stay inside the config's directory. The gateway refuses invalid configuration at startup with an error.
- A banner around **700 x 190** pixels fits the welcome panel. It is fitted inside the existing border without stretching. The loading rune animation is hidden only when a custom banner is available.
- A background around **765 x 503** pixels matches the native login canvas. Other proportions are scaled and cropped to fill it.
- Bottom text is plain text, up to 400 characters. Use `\n` for new lines; three or four short lines fit the parchment best. Markup is displayed literally.
- Leave any setting `null` or omit it to keep that stock element. The client keeps the stock element if its branding fetch fails; branding does not block normal login.
- Restart the gateway and RuneLite after changing config/images; **no rebuild is required**. The gateway serves the selected files to the client over its existing loopback HTTP port, so no separate web host is needed.
- To keep the config elsewhere, pass `-BrandingFile path/to/branding.json` to the gateway launcher. Resolve image paths relative to that file as usual.

The pictured post-login welcome interface and the pre-login background are separate screens. The welcome screen has an opaque black backdrop with either stock or custom branding; Play reveals the game normally. Branding preserves the native Play button and login flow; it does not patch the game's cache or installed RuneLite profile.

These native screenshots use diagnostic example artwork, with 117 HD off:

![Configurable login background](images/runelite-branding-login.png)

![Configurable welcome banner and bottom text](images/runelite-branding-welcome.png)

## Stop

Log out normally and close RuneLite. Stop the gateway terminal, then stop TSPS and wait for `[shutdown] Player persistence completed.` Do not use an installed world's stop script.

## Verified behavior and limits

- Native cache/scene loading and normal TSPS account login; ground/minimap movement; inventory/equipment display and wielding; real NPC Talk-to and dialogue continuation; public chat with the crown before the name; normal logout and saved-position relog.
- These checks used a separate TSPS world and disposable account. Sword/coins and an NPC were controlled QA fixtures, not acquisition tests.
- Branding QA without117HD: custom login background and welcome banner/footer rendered from config; disabling restored stock artwork/loader/footer, re-enabling and relog reapplied branding, and native Play/logout worked. Six gateway tests and31 client transport/lifecycle checks cover the new paths; no full-suite rerun.
- Three actual keyboard-submitted public messages rendered once each. Native diagnostics also confirmed the chat entry and overhead text. Optional 117 HD rendered the same TSPS world on an RTX 5090; startup alone was not counted as scene verification.
- Welcome-backdrop correction: eight focused retained-raster checks passed. Real native QA verified black welcome backgrounds with standard rendering and optional117HD, resize/restore, stock branding disabled, Play into gameplay and normal logout. Only affected client helpers were rebuilt; no server or gateway changes were needed.
- Focused checks cover observer-filtered snapshots, private-instance visibility/removal, unchanged normal binary packets, fail-closed oversize snapshots, real cache/JS5/Huffman, native inputs, UI/inventory/stat translation, serialized WebSocket writes, chat bursts/index reuse and launcher save isolation. See tool READMEs for commands and pins. No full repository suite was run.
- Compatibility remains incomplete for shops, trade, custom interfaces, dynamic objects/ground items, instances and Sailing. Actor forced movement/custom models and broader remote-chat scenarios need further work. One native connection is supported; login does not establish all-content or gameplay parity.
- Native cache bounds omit browser-only overlay varps 7995-7999 and absent legacy 317 widgets. They cannot be forwarded directly to the native client.

![Native public chat verification](images/runelite-gateway-chat.png)

![Optional 117 HD rendering](images/runelite-gateway-117hd.png)

## Implementation and troubleshooting

- [Gateway](https://github.com/RSPSApp/tsps/blob/main/tools/runelite-gateway/README.md): RSProt version, cache/framing details, configuration and focused checks.
- [Client launcher](https://github.com/RSPSApp/tsps/blob/main/tools/runelite-client/README.md): RuneLite/RSProx/renderer pins, signature verification and private runtime.
- `-TraceInput` on the gateway and `-Diagnostics` on the client enable opt-in debugging; public/game chat text can appear in local logs. Normal launches leave these off. Do not publish private runtime keys, account databases or logs.
