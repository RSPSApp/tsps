# World Admin player tools

Open `http://localhost:49600/?view=players` on the assigned worktree.
World Admin authenticates with its own owner token. If the browser is not signed in, open
`http://localhost:49600/?token=<your token>` once, then select **Players**.
`WORLD_ADMIN_PORT` or the assigned worktree slot changes this port. Use the actual link printed at startup.
Use the configured `WORLD_ADMIN_TOKEN`, or the token in
`server/data/definitions/world-admin.token` when no environment token is set.
The startup message identifies the token source without logging its value.
Never paste the token into a report, commit, screenshot, or shared link. The panel
sets an HttpOnly, SameSite cookie and redirects to a URL without the token.

The default listener is loopback-only. Existing WorldAdmin Host, token and Origin
checks apply to all player-tool routes. Whoever has the panel token already has
world-owner authority, including the existing ability to assign staff ranks.

Search the existing player table and select a player. The heading names the target
of every tool. Gameplay changes require that human player to be online, alive and
finished teleporting. Controls remain unavailable for offline players. Bots belong
in the existing Bots pane.

- **Teleport:** choose World spawn or a named destination from TSPS's spell
  teleport registry, or enter whole X/Y coordinates from 0 to 16383 and plane 0 to
  3. This is an owner teleport that bypasses travel requirements. Arbitrary
  coordinates may be blocked tiles. Players must leave private instances in game
  first, so a web teleport cannot leave stale instance membership behind.
- **Give items:** search names or an exact ID, select a named result, and enter a
  positive whole quantity up to 2147483647. Results include loaded custom items
  and noted variants. Bank placeholders are excluded. IDs distinguish identically
  named variants. The inventory API decides how much fits, and the result reports
  the actual amount given.
- **Edit stats:** select a named skill and set its base level. Current level and
  XP update together, as with `::setlevel`. Hitpoints has a minimum of 10; other
  skills start at 1. Maximums come from TSPS. The controls show current level,
  base level and XP, including Sailing. Restore sets current levels to their base
  values and refills run energy without changing base levels or XP.
- **Edit quests:** when QuestCommand is enabled and quests are registered, select
  a named quest and Complete or Reset. Complete calls the quest's existing
  completion routine, including rewards and quest points. Reset uses the existing
  stage-reset semantics and adjusts quest points. It does not undo item/XP rewards
  or quest-specific saved progress. A later completion after reset may award
  rewards again. The form requires acknowledgement before sending a change.
- Existing rank assignment, kick, ban/unban, mute/unmute, saved inventory,
  equipment, banks and gameplay JSON inspection remain available.

Online skill and position previews read the live player. Other save-preview
fields show the persisted snapshot. Each new gameplay action saves the live
entity through the configured player persistence backend and waits for `flush()`. A save
failure explicitly reports that the live change already happened; repeating an
item or quest grant in that situation can duplicate rewards.

To disable just the web gameplay controls, merge this into the existing local
configuration and apply at a planned restart:

```json
{ "pluginConfig": { "WorldAdmin:playerTools": false } }
```

Merge the option into your existing settings. The World Admin Players pane still
offers moderation when player tools are disabled.

Run the browser player tool checks after building the server.

```sh
cd server
node --test tests/world-admin.test.cjs tests/world-admin-player-tools.test.cjs
cd ../client
./node_modules/.bin/tsx --test tests/world-admin-player-tools.test.ts
```
