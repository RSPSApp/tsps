# Item editor

The item editor is a local development tool for browsing cache and custom items,
creating cache-based custom variants, recolouring models, editing inventory icon
framing, bonuses and level requirements, and previewing equipment and animations.
It uses the existing client cache loaders and renderers. No dependency is added.

## Start

Set `ITEM_EDITOR_ENABLED=1` in your local root `.env`, then start TSPS normally
with `yarn start`. Open `http://localhost:<PORT>/?items=1` and wait for the cache
to load. A game login is not required. Use the client port assigned to your
checkout. On a public server, leave the setting unset.

The browser can edit drafts and export JSON without the authoring service.
Saving requires a local HTTP client at `localhost` or `127.0.0.1` on `PORT`
(default 3000). The write service binds to `127.0.0.1` on `WEBSOCKET_PORT + 1100`
and accepts only the configured local origin. Browser-host worlds do not start it.
The standard content API remains read-only.

## Use

1. Search Cache items by name or exact ID. Inventory and Ground show the item;
   Model A and Model B show the male and female reference bodies. Disabled
   equipment previews explain why they are unavailable. Offhand selection is
   preview-only and can add a shield or defender to either body.
2. Select Add as custom. The editor allocates an unused ID in 60000–65022.
   Notes and placeholders cannot be used as bases. Existing customs below
   60000 are viewable and remain read-only.
3. Edit the name, examine, value, tradeability, recolours or icon framing.
   Load inherited stats before changing individual bonuses or requirements.
   Select matching shades and Preserve shading help retain material detail.
   A colour shared by several model parts changes all of those parts.
4. Compare original and edited appearances, use Undo/Redo, or export JSON.
   Drafts and palettes are saved in browser storage for this server and item.
   Back to viewer keeps a draft; Discard draft archives it for recovery.
5. Save custom item writes `server/data/definitions/custom-items.json` through
   a temporary file and rename. All unrelated custom definitions are preserved.
   Restart the game server before using the changed item in game.

Reload saved items refreshes the document. A stale revision or occupied ID
blocks saving and retains the draft. Rebase draft explicitly accepts the
current revision; Use next free ID resolves a collision for a new custom.
The save service validates definitions, cache bases and the compressed content
packet size before writing. It does not modify the original cache.

## Animations and limits

Animations & combat styles shows the game's weapon profile, style animations,
XP skills, and registered special attack information. Play runs a cache sequence
once on Model A or B. Preview animation ID accepts an existing sequence ID.
The preview respects sequence hand-item replacements and supports classic and
skeletal sequences. It does not change a saved animation assignment.

Special attack IDs are read from literal `new Animation(...)` expressions in
the registered plugin's source; dynamic IDs are not inferred. The preview does
not execute combat or play special graphics, projectiles or sounds. Copying an
item does not register its special attack or passive behaviour under a new ID.

Model upload, texture editing, custom sequence import and changing equipment
or combat categories are outside this version. Equipped items can legitimately
have no visible geometry, such as rings and ammunition. Preview lighting and
the Ground scale reference do not reproduce a complete game scene.

## Verification

From `server/`, build with `yarn build`, then run
`node --test tests/item-editor.test.cjs`. From `client/`, run `yarn typecheck`,
`node --import tsx tests/item-editor.test.ts`, and
`node --import tsx tests/player-equipment-arms.test.ts`.
The tests use the project's real cache; save tests use temporary documents.
No example custom items should be left in the game document after testing.

Before publishing, check the browser with iron ore 440, bronze dagger 1205,
noted dagger 1206, bronze platebody 1117, a shield, and an existing custom.
Check Inventory/Ground, both bodies, offhand removal, animation Play/Stop,
recolour comparison, draft recovery, a save/reload conflict, and narrow layouts.
Confirm that a saved variant looks the same after restarting the test world.
Use isolated test data for this final save check.
