# RuneLite-shaped client plugin API: implementation plan

**Goal:** give the browser client a plugin API that matches RuneLite's (`../runelite`) closely enough that porting a RuneLite plugin is a mechanical translation from Java to TypeScript. The class names, method names, event names, event getters and ID constants stay the same. Only the language changes.

**Non-goal:** running Java plugins, or Swing compatibility. Swing panels are the one area where a port means a rewrite (in React), and this plan keeps that area small.

---

## 1. Where we are today

| Area | Today | File(s) |
|---|---|---|
| Plugin contract | `ClientPlugin` with about 15 optional render, camera, menu and command hooks. Only HD, first-person, menu swapper and gameframe317 implement it. | `client/game/plugins/ClientPluginManager.ts` |
| Plugin construction | Built by hand, one field per plugin, in `OsrsClient` | `client/game/OsrsClient.ts` (≈1180–1240) |
| Core → plugin coupling | Renderer and sidebar call plugins by field name (`osrsClient.groundItemsPlugin.…`) | `render/render/interact/*`, `render/render/frame/render.ts`, `game/sidebar/SidebarShell.tsx` |
| Events | None for plugins. The network layer has per-packet listener sets (`subscribeTick`, `subscribeChatMessages`, `subscribeInventory`, `subscribeSkills`, `subscribeNpcInfo`, `subscribePlayerSync`, `subscribeGroundItems`, …) | `client/network/serverConnection/subscriptions/*`, `state.ts` |
| Config | Each plugin has a hand-written `types.ts` config interface, sanitizers, a `Browser*Persistence` localStorage wrapper and `subscribe`/`getState`/`setConfig` | `client/game/plugins/*/` |
| Config UI | A hand-written React panel per plugin, plus a hard-coded toggle list in the plugin hub (now replaced: the generated `ConfigPanel`, the plugin hub, and `ClientToolbar` for side panels, see Phase 5) | `game/sidebar/SidebarShell.tsx` (1071 lines), `OsrsClient.syncSidebarPlugins` |
| Overlays | An internal WebGL `Overlay`/`OverlayManager` (init/update/draw by `RenderPhase`), fed a large `OverlayUpdateArgs.state` bag. Not plugin-facing. | `client/ui/devoverlay/Overlay.ts`, `OverlayManager.ts` |
| Menus | One `transformMenuEntries(SimpleMenuEntry[])` pass. Clicks go through `MenuState.invoke` → `menuAction(arg0, arg1, opcode, identifier, itemId, option, target, x, y)`, which already has RuneLite's `MenuOptionClicked` field set. | `ui/menu/menuTransforms.ts`, `MenuState.ts`, `MenuAction.ts` |
| Vars | `VarManager.onVarpChange(varpId, old, new)`, a single callback slot that `OsrsClient` already uses | `rs/config/vartype/VarManager.ts`, `OsrsClient.ts` (≈6454) |
| Scripts | A full CS2 VM with an int stack, `execute(script, …)` and event handlers | `rs/cs2/Cs2Vm.ts` |
| Actors | Struct-of-arrays ECS (`PlayerEcs`, `NpcEcs`), addressed by a reusable index | `game/ecs/*` |
| Game state | Our own `GameState` enum. Its values differ from RuneLite's (for example our `CONNECTION_LOST = 100`, RuneLite's is `40`) | `game/login/GameState.ts`, `game/state/GameStateMachine.ts` |

## 2. What RuneLite plugins actually use

We measured this across the 137 plugins in `runelite-client/.../plugins`, and it sets the priority order below.

**Events (number of `@Subscribe` handlers):** GameStateChanged 57, ConfigChanged 57, GameTick 50, ChatMessage 42, VarbitChanged 27, ScriptPostFired 19, MenuOptionClicked 18, MenuEntryAdded 18, NpcDespawned 17, ScriptCallbackEvent 16, ItemContainerChanged 16, GameObjectSpawned 14, WidgetLoaded 13, ScriptPreFired 13, NpcSpawned 13, ProfileChanged 10, StatChanged 9, GameObjectDespawned 9, InteractingChanged 8, CommandExecuted 7, ClientTick 7, NpcChanged 6, FocusChanged 6, HitsplatApplied 5, BeforeRender 5, WidgetClosed 4, ItemSpawned/Despawned 4, AnimationChanged 4, PostClientTick 3, GraphicChanged 3, VarClientIntChanged 3, MenuOpened, PostMenuSort.

**Services (plugins that use each one):** ConfigManager 117, Client 109, OverlayManager 69, ClientThread 62, ItemManager 45, OverlayUtil 28, Perspective 27, InfoBoxManager 24, Notifier 23, ChatMessageManager 21, ClientToolbar 17, ScheduledExecutorService 17, SpriteManager 16, KeyManager 15, PluginPanel 14, TooltipManager 13, EventBus (direct) 13, ChatboxPanelManager 9, MouseManager 6, MenuManager 5.

**`Client` methods (by number of call sites, 208 distinct methods used):** getWidget 249, getVarbitValue 232, getLocalPlayer 213, getGameState 79, getTickCount 72, getRealSkillLevel 67, getItemContainer 66, getPlane 51, getBoostedSkillLevel 49, getVarpValue 47, createMenuEntry 40, getEnum 33, getWorld 32, getIntStack 32, runScript 29, getIntStackSize 28, getTopLevelWorldView 24, getWorldType 22, getMenuEntries 22, refreshChat 20, getGameCycle 20, getMouseCanvasPosition 19, getItemDefinition 18, getMapRegions 17, getObjectDefinition 16, getVarc{Int,Str}Value 15, set/clearHintArrow 14, isMenuOpen 12, playSoundEffect 11, getSkillExperience 11, addChatMessage 11.

These three lists act as the backlog. Section 9 adds a script that keeps the list honest.

---

## 3. Porting conventions (the "1:1" contract)

Every decision below is aimed at making a port a find-and-replace job.

| Java (RuneLite) | TypeScript (ours) | Notes |
|---|---|---|
| `package net.runelite.client.plugins.foo;` | file lives in `client/runelite/client/plugins/foo/` | Mirrors the Java package path |
| `import net.runelite.api.events.GameTick;` | `import { GameTick } from "@runelite/api/events";` | Path aliases `@runelite/api`, `@runelite/client`, `@runelite/awt` (tsconfig `paths`, plus a craco webpack alias; tsx already honours tsconfig paths) |
| `@PluginDescriptor(name = "Boosts", tags = {...})` | `static descriptor: PluginDescriptor = { name: "Boosts", tags: [...] }` | No decorators: CRA's Babel config doesn't enable them and we don't want to change the build |
| `@Inject private Client client;` | `private client = inject(Client);` | `inject()` reads the current injector, which `PluginManager` sets while it constructs the plugin (Angular-style). Same result, no decorators. |
| `@Provides FooConfig provideConfig(ConfigManager c) { return c.getConfig(FooConfig.class); }` | delete it. `private config = inject(FooConfig);` | The injector resolves any config group automatically |
| `@Subscribe public void onGameTick(GameTick e)` | `onGameTick(e: GameTick): void` | `EventBus.register(obj)` binds methods by name (`on` + event class name). Every RuneLite subscriber already follows this convention. Priority: optional `static subscribe = { onGameTick: { priority: 5 } }`. |
| `@Override protected void startUp() throws Exception` | `protected async startUp(): Promise<void>` | Async is allowed (sprite/cache loads); the manager awaits it |
| `event.getMessage()`, `event.setMessage(x)` | identical | Events are classes with Lombok-style getters and setters, not plain objects |
| `client.getLocalPlayer().getWorldLocation()` | identical | Getters stay methods, never become properties |
| `ItemID.ABYSSAL_WHIP`, `VarbitID.…`, `InterfaceID.…` | identical, via `import * as ItemID from "@runelite/api/gameval/ItemID"` | Generated from `runelite-api/.../gameval/*.java`. Each constant is its own named export, so webpack tree-shakes the roughly 100k lines down to what is used. |
| `java.awt.Color`, `Point`, `Rectangle`, `Polygon`, `Shape`, `BasicStroke`, `Font`, `Dimension` | same names from `@runelite/awt` | Thin shim, see §4.8 |
| `Graphics2D` | `Graphics2D` from `@runelite/awt` wrapping `CanvasRenderingContext2D` | See §4.8 |
| `clientThread.invoke(() -> …)` / `invokeLater` | identical | Single-threaded: `invoke` runs now if we're on a client tick, otherwise queues; `invokeLater` queues to the end of the current or next client tick |
| `executor.schedule(r, 5, SECONDS)` | `ScheduledExecutorService` shim over `setTimeout`/`setInterval` | Small, used by 17 plugins |
| `int`, `long`, `boolean`, `String` | `number`, `number`, `boolean`, `string` | Ports must keep `| 0` wherever Java relies on int overflow or truncation (bit-packed varps, hashes) |
| `List<T>`, `Map<K,V>`, `Set<T>` | `T[]`, `Map`, `Set` | Actor wrappers keep a stable identity (§4.5), so `Set<NPC>` works |
| Swing `PluginPanel` | React component passed to `NavigationButton` | The one non-mechanical part of a port |

**Licence:** RuneLite is BSD-2-Clause. Every ported plugin file keeps RuneLite's copyright header, with a "Ported to TypeScript" line added.

---

## 4. Architecture

New top-level folder **`client/runelite/`**, split the same way as RuneLite:

```
client/runelite/
  api/            # net.runelite.api — Client interface, model types, events, gameval, Perspective, coords
    events/       # one file per event class (GameTick.ts, ChatMessage.ts, …) + index.ts barrel
    gameval/      # generated ItemID.ts, VarbitID.ts, InterfaceID.ts, NpcID.ts, ObjectID.ts, AnimationID.ts, SpotanimID.ts, VarPlayerID.ts, VarClientID.ts, SpriteID.ts, InventoryID.ts
    coords/       # WorldPoint, LocalPoint, WorldArea
  awt/            # java.awt shim: Color, Point, Rectangle, Polygon, Dimension, BasicStroke, Font, Graphics2D
  client/         # net.runelite.client — plugins, config, eventbus, ui/overlay, game, callback, chat, input, util
    plugins/      # ported + migrated plugins, one folder each
  impl/           # adapters from our engine to the api (ClientImpl, NpcImpl, PlayerImpl, WidgetImpl, event emitters)
```

`api/` and `client/` contain only RuneLite-shaped code. Everything that touches `OsrsClient`, the ECS, `VarManager` or `Cs2Vm` lives in `impl/`, so the API surface never leaks engine types. The ARCHITECTURE.md file-size rule (100–150 lines, hard cap 400) applies: one class per file, as in RuneLite. Generated `gameval/` files are exempt.

### 4.1 EventBus — `client/runelite/client/eventbus/EventBus.ts`

- `register(subscriber)`: walks the prototype chain, binds every `on<EventName>` method whose `<EventName>` is a known event class, and sorts by priority (higher first, as in RuneLite).
- `unregister(subscriber)`, `post(event)`, and `subscribe(EventClass, handler, priority)`, which returns an unsubscribe function for non-plugin code.
- Dispatch is keyed by the event's constructor and uses no string lookups in the hot path. Each subscriber call is wrapped in try/catch, so one throwing plugin is logged with its name and does not break dispatch (RuneLite behaves the same way).
- Profiling hook: with `profiler.enabled`, record time per subscriber (reuse `render/PerformanceProfiler`).
- A single instance, owned by `RuneLite` bootstrap (§4.11).

### 4.2 Plugin, PluginManager, injector — `client/runelite/client/plugins/`

- `abstract class Plugin { protected async startUp() {}; protected async shutDown() {}; resetConfiguration() {} }`
- `PluginDescriptor`: `name, description, tags, enabledByDefault (true), hidden, developerPlugin, conflicts, loadWhenOutdated`. `PluginDependency` becomes `static dependencies = [OtherPlugin]`.
- `PluginManager`:
  - `loadCorePlugins()` takes a static list (`client/runelite/client/plugins/index.ts`). Phase 6 adds dynamic plugins.
  - Enabled state is stored as config key `runelite.<classname-lowercase>` = `"true"`/`"false"`, which is RuneLite's own key format.
  - `setPluginEnabled(p, bool)` → `startPlugin`/`stopPlugin`. Start means: construct the plugin inside the injector context, `await startUp()`, then `eventBus.register(plugin)`. Stop means: `eventBus.unregister(plugin)`, then `await shutDown()`. Posts `PluginChanged`.
  - Startup errors are caught; the plugin is marked failed and the hub panel shows it.
- `inject(Token)`: the injector is a `Map<constructor, instance>` holding singletons (`Client`, `ConfigManager`, `OverlayManager`, `ItemManager`, …). A config class token resolves to `configManager.getConfig(Token)`. Plugins can inject other plugins (RuneLite allows this).
- **Existing `ClientPlugin` hooks** (shader, camera, gameframe, client command) stay; RuneLite has no equivalent, and its nearest counterpart is `DrawCallbacks`. `Plugin` may implement any `ClientPlugin` method. `ClientPluginManager` iterates enabled plugins from `PluginManager`, not its own `add()` list, so the HD and gameframe hooks follow enable/disable automatically.

### 4.3 ConfigManager and generated config UI — `client/runelite/client/config/`

Java config interfaces have no runtime form in TS, so a config is a **descriptor object** that returns an accessor with RuneLite's call-site shape:

```ts
// Java: @ConfigGroup("grounditems") interface GroundItemsConfig extends Config { @ConfigItem(keyName="highlightedItems", name="Highlighted Items", description="…", position=0) default String getHighlightItems() { return ""; } }
export const GroundItemsConfig = ConfigGroup("grounditems", {
    getHighlightItems: ConfigItem({ keyName: "highlightedItems", name: "Highlighted Items", description: "…", position: 0, default: "" }),
    highlightedColor:  ConfigItem({ keyName: "highlightedColor", name: "Highlighted item", position: 3, default: Color.decode("#AA00FF"), alpha: true, section: "colorsSection" }),
    priceDisplayMode:  ConfigItem({ keyName: "priceDisplayMode", name: "Price Display Mode", default: PriceDisplayMode.BOTH, enum: PriceDisplayMode }),
}, { sections: { colorsSection: ConfigSection({ name: "Colors", position: 1, closedByDefault: true }) } });
export type GroundItemsConfig = ConfigOf<typeof GroundItemsConfig>;
// call sites unchanged: config.getHighlightItems(), config.highlightedColor()
```

- The value type is inferred from `default`: boolean, number (`range: {min,max}`, `units`), string (`textArea`, `secret`), `Color` (`alpha`), enum (dropdown), `Keybind`/`ModifierlessKeybind`, `Set<Enum>` (multi-select). Also supports `hidden`, `warning`, `section`, `position`.
- `ConfigManager`: `getConfiguration(group, key, type?)`, `setConfiguration`, `unsetConfiguration`, `getConfig(Group)`, `getConfigDescriptor(Group)`, plus RS-profile variants (`getRSProfileConfiguration` etc.) keyed `rsprofile.<accountname>`. Posts `ConfigChanged(group, key, oldValue, newValue)`. Values are serialised to strings the way RuneLite does it (Color as `#AARRGGBB`, enums by name), so exported RuneLite settings could later be imported.
- Storage: one localStorage namespace, `rl.config.<group>.<key>`. Writes are debounced; reads come from an in-memory map. Changes made in another tab arrive through the `storage` event.
- **Generated settings panel** (`client/runelite/client/ui/config/ConfigPanel.tsx`): renders any descriptor (sections, ordering, widgets per type), with the same look as today's `rl-sidebar-*` CSS. It replaces the hand-written panels in `SidebarShell.tsx`.
- **Plugin hub** (`PluginListPanel.tsx`): lists every plugin from `PluginManager` with toggle, search by name/tags, and a cog that opens the generated config panel. This replaces the hard-coded `pluginToggles` and `syncSidebarPlugins`.
- **Migration shim:** on first run, read each legacy `osrs.plugin.<name>.v1` blob, write its fields into the new keys, and record `rl.config.migrated.<name>`. No user loses settings.

### 4.4 `Client` facade — `client/runelite/api/Client.ts` (interface) + `impl/ClientImpl.ts`

The interface mirrors `runelite-api/.../Client.java` (2420 lines) in name and signature, but only methods we implement are declared. Unimplemented methods are absent rather than stubbed, so a port that needs one fails at compile time, not at runtime. Implementation order follows the usage counts in §2:

| Tier | Methods | Backed by |
|---|---|---|
| 1 | `getGameState`, `getTickCount`, `getGameCycle`, `getLocalPlayer`, `getNpcs`, `getPlayers`, `getPlane`, `getVarbitValue`, `getVarpValue`, `getVarps`, `getVarcIntValue`, `getVarcStrValue`, `getRealSkillLevel`, `getBoostedSkillLevel`, `getSkillExperience`, `getOverallExperience`, `getItemContainer`, `getWidget`, `getEnergy`, `getWeight`, `getWorld`, `getWorldType`, `isInInstancedRegion`, `getMapRegions`, `addChatMessage`, `refreshChat`, `getMouseCanvasPosition`, `isMenuOpen`, `getCanvas`, `getCanvasWidth/Height`, `isResized`, `getLocalPlayer().getName()` | `GameStateMachine`, `TransmitCycles`/`getCurrentTick`, `PlayerEcs`/`NpcEcs`, `VarManager`, skills/inventory/bank stores in `network/serverConnection/domain`, `WidgetManager`, chat history |
| 2 | `createMenuEntry`, `getMenuEntries`, `setMenuEntries`, `getMenu()`, `getEnum`, `getStructComposition`, `getItemDefinition`, `getNpcDefinition`, `getObjectDefinition`, `getDBTableField`, `runScript`, `getIntStack`, `getIntStackSize`, `getObjectStack`, `getObjectStackSize`, `setVarcIntValue`, `setVarcStrValue`, `playSoundEffect`, `setHintArrow`/`clearHintArrow`/`getHintArrow*`, `getTopLevelWorldView`, `getScene`, `getSelectedSceneTile`, `getCameraX/Y/Z/Pitch/Yaw`, `getViewportXOffset/YOffset/Width/Height`, `getFriendsChatManager`, `getFriendContainer` | `MenuState`, cache type loaders, `Cs2Vm`, `HintArrow.ts`, `Camera.ts`, `MapManager`/scene |
| 3 | Everything else, driven by what the next ported plugin needs | |

Model types live in `api/`: `Actor`, `Player`, `NPC`, `NPCComposition`, `ItemComposition`, `ObjectComposition`, `ItemContainer`, `Item`, `Widget`, `MenuEntry`, `Tile`, `TileItem`, `GameObject`/`WallObject`/`GroundObject`/`DecorativeObject`, `Skill`, `GameState`, `ChatMessageType`, `MenuAction`, `InventoryID`, `WorldType`, `Prayer`, `HeadIcon`, `SkullIcon`, `HintArrowType`, `AnimationID` and the other gameval constants.

**Enum values are RuneLite's.** `GameState` maps ours onto RuneLite's: DOWNLOADING→UNKNOWN(-1), LOADING→STARTING(0), LOGIN_SCREEN→LOGIN_SCREEN(10), CONNECTING→LOGGING_IN(20), LOADING_GAME→LOADING(25), LOGGED_IN→LOGGED_IN(30), RECONNECTING/CONNECTION_LOST→CONNECTION_LOST(40), PLEASE_WAIT→HOPPING(45). `ChatMessageType` uses the raw OSRS channel id we already carry (`ChatMessageEvent.chatType`).

### 4.5 Actor wrappers with stable identity — `impl/NpcImpl.ts`, `impl/PlayerImpl.ts`

The ECS reuses indices, while RuneLite plugins keep `NPC` references in Sets and Maps for as long as the NPC is spawned. So:

- One wrapper per spawn. It is created when the NPC/player is added to the ECS, stored in `npcWrappers[index]`, and posted as `NpcSpawned`. On removal it is marked `isDead`/detached, posted as `NpcDespawned`, then the slot is cleared. A new spawn in the same index gets a new wrapper object.
- Wrappers hold only `index` and the ECS reference, and every getter reads live (`getWorldLocation()`, `getLocalLocation()`, `getAnimation()`, `getGraphic()`, `getInteracting()`, `getHealthRatio()/getHealthScale()`, `getOverheadText()`, `getOrientation()`, `getComposition()`/`getTransformedComposition()`, `getId()`, `getIndex()`, `getName()`, `getCombatLevel()`, `getLogicalHeight()`, `getCanvasTilePoly()`, `getCanvasTextLocation()`, `getConvexHull()`).
- `getConvexHull()`/`getModel()` need projected model vertices. Phase 4 delivers them as a renderer-side query, not as a per-frame cost.

### 4.6 Coordinates and Perspective — `api/coords/`, `api/Perspective.ts`

- `WorldPoint(x, y, plane)`: absolute tile coordinates with `distanceTo`, `isInArea`, `dx/dy`, `getRegionID`, `fromLocal`, `fromRegion`, and `fromLocalInstance` (instance template lookup; we already have instance support in the scene).
- `LocalPoint(x, y, worldView)`: 128 fine units per tile, relative to the scene/world-view base, with `fromWorld(client|worldView, WorldPoint)` and `getSceneX/Y`. **Phase 2 spike:** confirm the scene base our renderer uses for local coords. `OverlayUpdateArgs` mixes "world tile units" and fine units.
- `Perspective.localToCanvas`, `getCanvasTilePoly`, `getCanvasTileAreaPoly`, `getCanvasTextLocation`, `getCanvasImageLocation`, `getCanvasSpriteLocation`, `getTileHeight`, `localToMinimap`, `worldToMinimap`. Built on the existing projection (`OverlayUpdateArgs.helpers.worldToScreen`, `getTileHeightAtPlane`, `getMinTileHeightInRadius`), exposed through `ClientImpl`, and cached per frame. The ~15 ad-hoc projection helpers in `render/` move behind this API over time.

### 4.7 Overlays — `client/runelite/client/ui/overlay/`

RuneLite overlays draw with immediate-mode `Graphics2D`. Our existing overlays are WebGL. The plan keeps both:

- A new **2D overlay canvas**: a transparent `<canvas>` (`CanvasRenderingContext2D`, DPR-aware) stacked above the GL canvas inside `GameContainer`. It is cleared and redrawn every rendered frame, after the GL present (`RenderPhase.PostPresent` timing).
- `abstract class Overlay implements LayoutableRenderableEntity`: `render(g: Graphics2D): Dimension | null`, `setPosition(OverlayPosition)`, `setLayer(OverlayLayer)`, `setPriority(number|PRIORITY_*)`, `setMovable`, `setResizable`, `setSnappable`, `setPreferredSize`, `getBounds`, `addMenuEntry`, `drawAfterInterface(InterfaceID…)`, `drawAfterLayer`, `getName`, `getPlugin`.
- `OverlayManager.add/remove/removeIf/anyMatch`. The `OverlayRenderer` sorts by layer and priority and lays out the snap corners (`TOP_LEFT`, `TOP_CENTER`, `TOP_RIGHT`, `ABOVE_CHATBOX_RIGHT`, `BOTTOM_LEFT`, `BOTTOM_RIGHT`, `CANVAS_TOP_RIGHT`, `TOOLTIP`). `DYNAMIC` overlays and `ABOVE_SCENE`/`UNDER_WIDGETS` layers draw unpositioned. Clipping to the scene viewport reuses `SceneViewportRect`.
- Layers versus widgets: the GL widget pass draws over the scene, and a 2D canvas on top would cover interfaces. `ABOVE_WIDGETS`/`ALWAYS_ON_TOP` sit on the top canvas. `ABOVE_SCENE`/`UNDER_WIDGETS` go to a **second 2D canvas between the scene and widgets**, but only if the GL widget pass can composite above it. **Phase 1 spike:** verify how `widgets/gl` presents. If widgets cannot be layered over a DOM canvas, render `UNDER_WIDGETS` overlays into an `OffscreenCanvas` uploaded as a texture before the widget pass.
- Alt-drag to move and snap overlays, with positions persisted under `runelite.<overlayname>_preferredLocation`. This comes in Phase 5; until then overlays sit at their default snap corner.
- `components/`: `PanelComponent`, `LineComponent`, `TitleComponent`, `ProgressBarComponent`, `ImageComponent`, `SplitComponent`, `TextComponent`, `ComponentOrientation`, `ComponentConstants`.
- `OverlayUtil`: `renderPolygon`, `renderTextLocation`, `renderActorOverlay`, `renderTileOverlay`, `renderImageLocation`, `renderMinimapLocation`, `renderHoverableArea`, `renderPrayerOverlay`.
- `WidgetItemOverlay` (inventory/bank item tags): needs the item slot rects from `WidgetManager`. Comes in Phase 4.
- `TooltipManager` + `TooltipOverlay`: add a tooltip for this frame and render it near the mouse.
- `InfoBoxManager` + `InfoBox`/`Counter`/`Timer`: rendered by an `InfoBoxOverlay` in a snap corner. RuneLite's per-box sprites come through `SpriteManager`.

Our existing WebGL overlays (hitsplats, health bars, overhead text and so on) stay as they are; they are engine rendering, not plugins.

### 4.8 java.awt shim — `client/runelite/awt/`

This is kept to the subset RuneLite plugins touch:
- `Color`: constructors `(r,g,b[,a])`, `(rgb[, hasAlpha])`, `getRed/Green/Blue/Alpha/RGB`, `brighter/darker`, `decode`, and the constants `WHITE BLACK RED GREEN BLUE YELLOW ORANGE CYAN MAGENTA PINK GRAY LIGHT_GRAY DARK_GRAY`. Also `ColorUtil` (`colorWithAlpha`, `wrapWithColorTag`, `prependColorTag`, `toHexColor`, `fromHex`).
- Geometry: `Point`, `Dimension`, `Rectangle` (`contains`, `intersects`, `union`), `Polygon` (`addPoint`, `contains`, `getBounds`), `Shape`, `Area` (union only), `geom.Rectangle2D`, `geom.Ellipse2D`, `geom.Line2D`, `geom.AffineTransform` (translate/rotate/scale).
- `BasicStroke(width)`, `Font(name, style, size)`, `FontMetrics` (`stringWidth`, `getHeight`, `getAscent`, `getDescent`) via `ctx.measureText`.
- `Graphics2D` over `CanvasRenderingContext2D`: `setColor/getColor`, `setFont/getFont`, `getFontMetrics`, `setStroke`, `drawString`, `drawRect/fillRect`, `drawPolygon/fillPolygon`, `draw(Shape)/fill(Shape)`, `drawLine`, `drawOval/fillOval`, `drawImage(BufferedImage, x, y, null)`, `translate`, `rotate`, `scale`, `getTransform/setTransform`, `setClip/getClip/clip`, `setRenderingHint` (accepted and ignored), `setComposite(AlphaComposite)` → `globalAlpha`, `create()/dispose()` via `save()/restore()`.
- `BufferedImage`: an `ImageBitmap`/`OffscreenCanvas` holder with `getWidth/getHeight`, plus `ImageUtil` (`loadImageResource`, `alphaOffset`, `luminanceOffset`, `resizeImage`, `outlineImage`).
- **Fonts:** `FontManager.getRunescapeFont()`, `getRunescapeSmallFont()` and `getRunescapeBoldFont()` must match RuneLite. Bundle the RuneScape TTFs RuneLite ships (`runelite-client/src/main/resources/net/runelite/client/ui/runescape*.ttf`) as `@font-face`, and keep the BSD notice.

### 4.9 Menus

- `MenuEntry` (api interface) is a view over one row of `MenuState`'s parallel arrays, exposing `getOption/setOption`, `getTarget/setTarget`, `getIdentifier`, `getType()/setType(MenuAction)`, `getParam0/getParam1`, `getItemId`, `isDeprioritized/setDeprioritized`, `onClick(cb)`, `getNpc()/getPlayer()/getActor()`, `getWidget()`, `createSubMenu()`, `setForceLeftClick`.
- `MenuEntryAdded`: posted whenever an entry is inserted while the menu is built, the equivalent of RuneLite's `insertMenuItem` callback. **Phase 3 spike:** confirm whether world and widget menus all go through `MenuState` (`ui/menu/MenuState.ts`) or are also built as `SimpleMenuEntry[]` in `WorldMenuBuilder`/`widgets/menu`. Whichever path builds them, the event must see every entry once.
- `MenuOpened` (entries snapshot, `setMenuEntries` allowed), `PostMenuSort` (right after sort and before display; this is where the left-click swap lives), and `MenuOptionClicked` (posted at the top of `menuAction()` with `consume()`; a consumed click sends no packet). The existing `tests/menu-click-consumption.test.ts` covers the consume path.
- `client.createMenuEntry(idx)`, `getMenuEntries()`, `setMenuEntries()` and `getMenu()` run during the event cycle.
- Once Phase 4 ports `menuentryswapper` on the new events, `transformMenuEntries` is deleted.

### 4.10 Other managers (Phase 5, ordered by usage)

| Service | Implementation |
|---|---|
| `ClientThread` | queue drained at end of client tick (20ms cycle) |
| `ItemManager` | `getItemComposition` (cache ObjType), `getItemPrice` (GE price we already use for ground items/market), `getItemStack`, `getImage(itemId, qty, stackable)` (render item icon via existing `ui/item` icon renderer into `BufferedImage`), `canonicalize` |
| `Notifier` | `notify(msg)` / `notify(Notification, msg)`: in-game chat message plus browser `Notification` (after permission is granted) plus optional sound/tray flash. Config lives in the `runelite` group as in RuneLite. |
| `ChatMessageManager` | `queue(QueuedMessage)`, `ChatMessageBuilder`; per-type chat colours from config |
| `ChatCommandManager` | `registerCommand("!kc", …)`. For a private server this is mostly local. |
| `SpriteManager` | `getSprite(id, file)`, `getSpriteAsync`, `addSpriteTo(button)` over cache sprite loader |
| `SkillIconManager` | skill icons as `BufferedImage` |
| `KeyManager`/`KeyListener`, `HotkeyListener`, `MouseManager`/`MouseListener`/`MouseWheelListener` | hooks into `InputManager` before game handling; `consume()` stops propagation. Wraps the existing `handleCameraKeys/Mouse/Scroll` |
| `ClientToolbar` + `NavigationButton` | becomes `SidebarStore` entries (`ClientSidebarPluginDefinition` is already this shape); `panel` is a React component |
| `ChatboxPanelManager` | `openTextInput(prompt).onDone(cb).build()` over the CS2 input dialog we already have |
| `WorldMapPointManager` | pins on `game/worldMap` |
| `ScheduledExecutorService` | `schedule`, `scheduleAtFixedRate`, `submit` over timers |
| `Gson`/`OkHttpClient` | `JSON` / `fetch`, with a tiny `Gson` shim (`toJson`/`fromJson`) so ported config parsing compiles |

### 4.11 Bootstrap — `client/runelite/client/RuneLite.ts`

This constructs the singletons and the injector, binds `impl/` emitters to engine sources, loads core plugins, mounts the overlay canvases, and registers the hub panel. `OsrsClient` calls `RuneLite.start(this)` once its stores exist. Afterwards it no longer constructs or references any plugin by name.

---

## 5. Event source map

Each emitter lives in `impl/events/<area>.ts` and subscribes to an existing engine source. **Core only gets generic hooks.** Where no hook exists, add a listener set (as in `network/serverConnection/state.ts`) or a single callback list, never plugin-specific code.

| Event | Source in our engine | Notes |
|---|---|---|
| GameTick | `state.tickListeners` (`handlers/authTick.ts`) | Must fire **after** the tick's PLAYER_SYNC / NPC_INFO / var / inventory packets have been applied, as RuneLite's does. Verify packet order. If the tick packet arrives first, defer posting to the end of the server tick batch. |
| ClientTick, BeforeRender, PostClientTick | client cycle loop (`render/render/tick*.ts`) and frame start | ClientTick is the 20ms cycle, not the render frame |
| GameStateChanged | `GameStateMachine` transition listener | Uses the mapped RuneLite enum |
| ChatMessage | message ingest **before** it reaches chat history | Mutable (`setMessage`, `getMessageNode().setValue`), then `refreshChat()`. Needs a pre-insert hook, not `subscribeChatMessages` (which runs after). |
| VarbitChanged | `VarManager.onVarpChange` → change to a listener list | One event per varp (`varbitId = -1`), plus one per varbit backed by that varp whose value changed. Needs a varp→varbits reverse index built once from `VarBitTypeLoader`. |
| VarClientIntChanged / VarClientStrChanged | VarManager varc setters | |
| ConfigChanged, ProfileChanged, RuneScapeProfileChanged | ConfigManager; login account change | |
| ItemContainerChanged | `inventoryListeners`, `bankListeners`, equipment source (verify), trade/shop if needed | `InventoryID` ids (93 inv, 94 worn, 95 bank). Container object is a snapshot with `getItems()`, `getItem(slot)`, `count(id)`, `contains(id)`. |
| StatChanged | `skillsListeners` (snapshot + delta) | One event per changed skill: `(skill, xp, level, boostedLevel)` |
| NpcSpawned / NpcDespawned / NpcChanged | `NpcUpdateDecoder` add/remove/transform | Wrapper lifecycle §4.5 |
| PlayerSpawned / PlayerDespawned / PlayerChanged | `PlayerSyncManager` add/remove/appearance | |
| AnimationChanged, GraphicChanged, InteractingChanged, OverheadTextChanged, HitsplatApplied, ActorDeath | `PlayerSyncActions`, `NpcUpdateDecoder`, `HitsplatFlushController` | |
| ItemSpawned / ItemDespawned / ItemQuantityChanged | `GroundItemStore` diff on `groundItemListeners` | Provides `TileItem` and `Tile` |
| GameObject/WallObject/GroundObject/DecorativeObject Spawned/Despawned | scene build plus `getWorldLocChanges`/loc-change packets | Phase 4. Scene build posts a spawn for every loc in the scene, as RuneLite does on region load. |
| WorldViewLoaded / WorldViewUnloaded | scene rebuild (`subscribeRebuildRegion/Normal/WorldEntity`) | |
| WidgetLoaded / WidgetClosed | `WidgetManager.openSubInterface` / `closeSubInterface` | |
| ScriptPreFired / ScriptPostFired | `Cs2Vm.execute` entry/exit (+ `runScriptEvent`) | Only post when a subscriber exists (VM hot path) |
| ScriptCallbackEvent | needs RuneLite's patched rs2asm scripts (64 in `runelite-client/src/main/scripts`), which call opcode `runelite_callback` | Phase 6: add the opcode to `Cs2Vm` and an rs2asm→cache-script override loader. Until then, plugins depending on it (chat timestamps, bank tags, etc.) are out. |
| MenuEntryAdded, MenuOpened, PostMenuSort, MenuOptionClicked | §4.9 | |
| CommandExecuted | `handleClientCommand` path (`::cmd`) | |
| FocusChanged | window `focus`/`blur` | |
| ClientShutdown | `beforeunload` | |
| PluginChanged, OverlayMenuClicked | PluginManager, overlay menus | |

---

## 6. Phases

Each phase ends with real RuneLite plugins ported unchanged except for the conventions in §3. This "canary" proves the shape. The ported plugin's Java source is diffed against the TS port during review; any change that isn't in the §3 table is either a gap in the API, fixed in the API, or written down as a known deviation in §8.

### Phase 0: scaffolding (small)
- `client/runelite/{api,awt,client,impl}` folders, the `@runelite/*` aliases in tsconfig plus craco webpack alias, and a check that `tsx` tests resolve them.
- `scripts/gen-gameval.ts`: parses `runelite-api/src/main/java/net/runelite/api/gameval/*.java` and writes `client/runelite/api/gameval/*.ts`. The files are committed, and the script header records the RuneLite commit they came from.
- `scripts/runelite-api-coverage.ts` (§9).
- **Done when:** aliases resolve in the webpack build and in `yarn test`; `ItemID.ABYSSAL_WHIP === 4151` in a test.

### Phase 1: core plugin runtime
- `EventBus`, `Plugin`, `PluginDescriptor`, `PluginManager`, `inject`, `ConfigManager` + descriptor DSL, generated `ConfigPanel`, `PluginListPanel` (the new plugin hub), legacy-config migration shim.
- `RuneLite.start()` bootstrap; `ClientPluginManager` iterates enabled plugins.
- Events: GameTick, ClientTick, BeforeRender, GameStateChanged, ConfigChanged, PluginChanged, CommandExecuted, FocusChanged.
- Client tier: `getGameState`, `getTickCount`, `getGameCycle`, `getCanvas*`, `getMouseCanvasPosition`.
- 2D overlay canvas plus `Overlay`/`OverlayManager`/`OverlayRenderer` (snap corners, no dragging), the `awt` shim, `Graphics2D`, `FontManager`, `PanelComponent`/`LineComponent`/`TitleComponent`, `TooltipManager`.
- **Spikes:** overlay layering against the GL widget pass (§4.7) and GameTick ordering (§5).
- **Canaries:** `fps` (a trivial overlay; it uses its own frame counter, not the engine's) and `mousehighlight` (tooltips, which need `MenuEntry` read access, so stub `getMenuEntries` read-only here).
- **Tests:** `tests/runelite-eventbus.test.ts` (register by method name, priority, an exception isolated to one subscriber, unregister), `tests/runelite-config.test.ts` (defaults, serialisation round-trip for Color/enum/number/bool, ConfigChanged, legacy migration), `tests/runelite-plugin-manager.test.ts` (enable/disable lifecycle and persistence).

### Phase 2: game-state API
- `ClientImpl` tier 1, `WorldPoint`/`LocalPoint`/`Perspective` (tile poly, text location, minimap), `Skill`, `ItemContainer`, `InventoryID`, `Widget` (read-only: `getBounds`, `isHidden`, `getChildren`, `getText`, `getItemId`, `getSpriteId`, `getCanvasLocation`).
- Events: VarbitChanged, VarClientInt/StrChanged, StatChanged, ItemContainerChanged, ChatMessage (pre-insert, mutable), WidgetLoaded/WidgetClosed.
- `ClientThread`, `ChatMessageManager`, `Notifier`, `InfoBoxManager` + `InfoBoxOverlay`, `SpriteManager`, `SkillIconManager`, `ItemManager` (composition, price, icon image).
- **Canaries:** `boosts` (StatChanged, InfoBox, overlay), `regenmeter` (VarbitChanged, ItemContainerChanged, widget-anchored overlay), `tileindicators` (Perspective tile polys).
- **Migrate:** `vengeancetimer`, `attacktimer` and `statustimer` become `Timer` InfoBoxes or overlays on the new API, and their hand-wired varbit and packet pokes are removed from `OsrsClient`.

### Phase 3: actors and menus
- `NpcImpl`/`PlayerImpl` with stable identity, `NPCComposition`, `Actor` getters (convex hull deferred to Phase 4, `getCanvasTilePoly` now).
- Events: Npc/Player Spawned/Despawned/Changed, AnimationChanged, GraphicChanged, InteractingChanged, HitsplatApplied, OverheadTextChanged, ActorDeath.
- Menus: `MenuEntry` view, `MenuEntryAdded`, `MenuOpened`, `PostMenuSort`, `MenuOptionClicked` with `consume()`, `createMenuEntry`/`setMenuEntries`.
- `KeyManager`, `MouseManager`, `HotkeyListener`, `Keybind` config type.
- **Canaries:** `idlenotifier` (actor and anim events, Notifier), `npchighlight` (spawn tracking, MenuEntryAdded tagging, tile and outline overlays; outline waits for Phase 4), `opponentinfo` (InteractingChanged, health ratio, `ScriptPostFired`, which is cheap to add here).

### Phase 4: scene, items, widget overlays, and migrating our plugins
- Tile/Scene API (`Tile`, `getSelectedSceneTile`, `TileItem`), ItemSpawned/Despawned/QuantityChanged, GameObject/Wall/Ground/Decorative spawn events, WorldViewLoaded/Unloaded.
- `Actor.getConvexHull()`/`getModel()` via a renderer-side projected-hull query, and `ModelOutlineRenderer` (RuneLite's outline). This could reuse the outline from `InteractHighlightOverlay`.
- `WidgetItemOverlay`.
- **Replace our hand-written plugins with ports of RuneLite's:** `grounditems`, `groundmarkers` (replaces `tilemarkers`), `menuentryswapper` (replaces `menuswapper`), `interacthighlight` (RuneLite has the same plugin). Each keeps its legacy-config migration. Delete the old folders and the plugin fields on `OsrsClient` (the per-plugin sidebar panels and `syncSidebarPlugins` are already gone, replaced by `ClientToolbar`).
- **Keep, moved onto `Plugin`:** `hd`, `firstperson`, `gameframe317`, `editmode`, `notes`, `rememberlogin`, `splitprivatechat`, `animationsmoothing`. These are ours; they get `Plugin` lifecycle and generated config, not a RuneLite port.

### Phase 5: polish and parity
- Overlay dragging, snapping and resizing, persisted positions, overlay right-click menus (`OverlayMenuEntry`), and `drawAfterInterface`/`drawAfterLayer`.
- RS-profile-scoped config, `ProfileChanged`, a config export/import that accepts RuneLite's `settings.properties` format for groups we support.
- `ChatboxPanelManager`, `ChatCommandManager`, `WorldMapPointManager`, `ScheduledExecutorService`, the `Gson` shim.
- **Done:** `ClientToolbar`/`NavigationButton` (`client/runelite/client/ui/`), with a React component as the `PluginPanel`.
  - Plugins add their button in `startUp()` and remove it in `shutDown()`: the hidden `ConfigPlugin` (the plugin hub, priority 0), Notes and Menu Entry Swapper.
  - The sidebar (`client/game/sidebar/Sidebar.tsx`) draws whatever is in the toolbar: a rail beside the game and the open panel, docked (the game narrows) or over the game (`RuneLiteConfig.sidebarMode`).
- **Canaries:** `xptracker` (side panel, RS profile, StatChanged), `statusbars`, `entityhider` (needs a render-side hide hook; this checks the `DrawCallbacks`-style extension).

### Phase 6: harder parity and external plugins (optional, decide later)
- `ScriptCallbackEvent`: the `runelite_callback` opcode in `Cs2Vm` plus loading RuneLite's patched `.rs2asm` scripts as overrides (an assembler is needed).
- Dynamic plugin loading (an ESM `import()` from a URL, i.e. a JS "plugin hub"). This needs a trust model before it ships: plugins run with full page access, so start with a curated list we build, never arbitrary URLs.

---

## 7. Testing approach

- All tests are `tsx` scripts in `client/tests/` and get picked up by `scripts/run-tests.mjs` automatically.
- Event emitters are tested by driving the engine source (for example, calling the varp setter or pushing a fake `InventoryServerUpdate` through `state.inventoryListeners`) and asserting the posted events.
- Canary ports each get one smoke test: construct the plugin with a fake `Client` built from the same `impl/` classes over seeded stores, post events, and assert overlay/infobox/notifier output. `Graphics2D` is tested against a recording fake context.
- The user does all in-game verification. Each phase's PR lists the in-game checks to do: canary visible, settings persist across reload, toggling in the hub starts and stops the plugin.

## 8. Known deviations and open questions

1. **No decorators.** The `inject()`, `ConfigGroup()` and `static descriptor` forms cover the gap. If we later turn on TS decorators in craco, we can add `@Subscribe`/`@Inject` as sugar without breaking ports.
2. **Threading.** RuneLite separates the client thread from the EDT and executors; we have a single thread. Ports that block (`Thread.sleep`, sync HTTP) need to become `async`. `ClientThread.invoke` returning `boolean` for retry is kept as-is.
3. **Swing panels** become React; plugins with panels (xptracker, loot tracker, notes) need manual porting there.
4. **GameTick ordering** (§5): this must be RuneLite-exact or tick-based plugins drift by a tick.
5. **Overlay layering** under widgets (§4.7) may cost a texture upload per frame if the DOM approach doesn't work.
6. **Convex hulls/outlines** need renderer cooperation, and the per-frame cost must stay at zero when unused.
7. **Varbit event volume:** posting per changed varbit needs the reverse index; posting must be skipped entirely when there are no `onVarbitChanged` subscribers.
8. **`ScriptCallbackEvent`** stays unavailable until Phase 6, and the coverage report flags plugins that need it.
9. **Server parity:** some RuneLite plugins assume OSRS server behaviour (packets, varbits) that our server may not emulate. That is a server gap, tracked separately, not an API gap.

## 9. Tracking "how close to 1:1 are we"

`scripts/runelite-api-coverage.ts` parses `../runelite`:
- `Client.java` method names vs. methods on our `Client` interface
- `api/events/*.java` vs. `client/runelite/api/events/*.ts`
- injected service types used by plugins vs. tokens in our injector
- for each RuneLite plugin, the set of events/services/`client.*` methods it uses, so it can report which plugins are **portable now** (all dependencies implemented) and what each of the rest is missing.

Output: a markdown table in `docs/runelite-api-coverage.md`, regenerated in each phase PR. The "portable now" count is the headline metric.

## 10. Out of scope

- Running RuneLite's Java code or reading `.jar` plugins.
- Jagex-account/launcher features, RuneLite session/accounts sync, the RuneLite plugin hub backend.
- Server-side plugins (the server has its own system).
