import { strict as assert } from "node:assert";
import { WorldPoint } from "@runelite/api/coords/WorldPoint";
import { ItemContainerChanged } from "@runelite/api/events";
import * as InventoryID from "@runelite/api/gameval/InventoryID";
import * as ItemID from "@runelite/api/gameval/ItemID";
import { ItemContainer } from "@runelite/api/Item";
import { RecordingGraphics2D } from "@runelite/awt/Graphics2D";
import { PanelComponent } from "@runelite/client/ui/overlay/components/PanelComponent";
import { ConfigManager } from "@runelite/client/config/ConfigManager";
import { EventBus } from "@runelite/client/eventbus/EventBus";
import { inject } from "@runelite/client/plugins/PluginInjector";
import { WorldMapPointManager } from "@runelite/client/ui/overlay/worldmap/WorldMapPointManager";
import { ClientState } from "../game/ClientState";
import { NpcEcs } from "../game/ecs/NpcEcs";
import { ClueScrollEmoteOverlay } from "../game/plugins/cluescrolls/ClueScrollEmoteOverlay";
import { EMOTE_CONTENTS, EMOTE_SCROLLABLE, EMOTE_SCROLLBAR, EMOTE_UNIVERSE } from "../game/plugins/cluescrolls/ClueScrollInterfaces";
import { ClueScrollMusicOverlay } from "../game/plugins/cluescrolls/ClueScrollMusicOverlay";
import { ClueScrollOverlay } from "../game/plugins/cluescrolls/ClueScrollOverlay";
import { ClueScrollPlugin } from "../game/plugins/cluescrolls/ClueScrollPlugin";
import { ClueScrollWorldMapPoint } from "../game/plugins/cluescrolls/ClueScrollWorldMapPoint";
import { ClueScrollWorldOverlay } from "../game/plugins/cluescrolls/ClueScrollWorldOverlay";
import { AnagramClue } from "../game/plugins/cluescrolls/clues/AnagramClue";
import { CipherClue } from "../game/plugins/cluescrolls/clues/CipherClue";
import { CoordinateClue } from "../game/plugins/cluescrolls/clues/CoordinateClue";
import { CrypticClue } from "../game/plugins/cluescrolls/clues/CrypticClue";
import { EmoteClue } from "../game/plugins/cluescrolls/clues/EmoteClue";
import { Inventory } from "../rs/inventory/Inventory";

// RuneLite's four Clue Scroll overlays over the client's overlay contract: the panel with the
// clue's hint and requirement warnings, the emote and music tab highlights that scroll once, the
// world overlay that draws nothing without scene geometry, and the world map point's edge swap.

// --- The stub engine -----------------------------------------------------------------------------------
const inventory = new Inventory(28);
const equipment = new Inventory(14);
const widgets = new Map<number, any>();
const dynamicChildren = new Map<number, any[]>();
const scriptRuns: number[][] = [];
const osrsClient: any = {
    gameState: 30,
    inventory,
    equipment,
    npcEcs: new NpcEcs(8),
    npcTypeLoader: { load: () => undefined },
    objTypeLoader: { load: (id: number) => ({ id, name: id === ItemID.SPADE ? "Spade" : `Item ${id}`, params: new Map() }) },
    varManager: { getVarbit: () => 0, getVarp: () => 0 },
    widgetManager: {
        getWidgetByUid: (uid: number) => widgets.get(uid),
        getDynamicChildrenByParent: (node: any) => dynamicChildren.get(node.uid) ?? [],
    },
    inputManager: { mouseX: 0, mouseY: 0 },
    cs2Vm: { isRunning: () => false, context: { loadScript: (id: number) => ({ id }) }, run: (script: any, args: number[]) => scriptRuns.push([script.id, ...args]) },
    controlledPlayerServerId: 1,
    playerEcs: { getIndexForServerId: () => 0, getX: () => 3200 * 128, getY: () => 3200 * 128, getLevel: () => 0, getName: () => "Kraken" },
    localPlayerName: "Kraken",
    addGameMessage: () => {},
};
ClientState.baseX = 3200;
ClientState.baseY = 3200;
ClientState.plane = 0;

const configManager = inject(ConfigManager);
const plugin = new ClueScrollPlugin({ client: osrsClient, configManager, chatboxPanelManager: {} as any, tagManager: undefined, worldMapPointManager: new WorldMapPointManager() });
const bus = new EventBus();
bus.register(plugin);
const metrics = { stringWidth: (text: string) => text.length * 6, getHeight: () => 16 };
const polylines: Array<Array<[number, number]>> = [];
const glr: any = {
    drawRect: () => {},
    drawPolygon: () => {},
    drawPolyline: (points: Array<[number, number]>) => polylines.push(points),
    drawTexture: () => {},
    getTexture: () => undefined,
    createTextureFromCanvas: () => ({}),
    deleteTexture: () => true,
};
const context: any = { renderer: glr, fontLoader: () => undefined, sprite: () => undefined, place: () => ({ x: 0, y: 0, scaleX: 1, scaleY: 1 }) };
const argb = (color: number) => color >>> 0;

async function main(): Promise<void> {
    await plugin.start();
    const overlays = plugin.widgetOverlays();
    const panel = overlays.find((o) => o instanceof ClueScrollOverlay) as ClueScrollOverlay;
    const world = overlays.find((o) => o instanceof ClueScrollWorldOverlay) as ClueScrollWorldOverlay;
    const emote = overlays.find((o) => o instanceof ClueScrollEmoteOverlay) as ClueScrollEmoteOverlay;
    const music = overlays.find((o) => o instanceof ClueScrollMusicOverlay) as ClueScrollMusicOverlay;
    assert.ok(panel && world && emote && music, "the plugin exposes its four overlays");
    assert.equal(world.drawBelowWidgets, true, "the world overlay sits under the interfaces (ABOVE_SCENE)");
    assert.equal(panel.movable?.name, "ClueScrollOverlay");

    // --- The panel: the clue's hint, then requirement warnings -----------------------------------------
    assert.equal(panel.render(new RecordingGraphics2D(metrics)), null, "nothing without a clue");
    const crate = CrypticClue.forText("a crate found in the tower of a church is your next location.")!;
    plugin.updateClue(crate);
    let recording = new RecordingGraphics2D(metrics);
    assert.ok(panel.render(recording), "a clue renders a panel");
    const texts = () => recording.strings.map((s) => s.text);
    assert.equal(texts()[0], "Cryptic Clue", "the clue kind is the title (RuneLite shows the solution, not the riddle)");
    assert.ok(texts().includes("Solution:"), "then the solution");
    assert.ok(!texts().includes("Requires Spade!"), "a cryptic clue with an object needs no spade");
    assert.ok(panel.menuEntries().some((e) => e.option === "Reset"), "the overlay offers Reset");

    const observatory = CoordinateClue.forLocation(new WorldPoint(2479, 3158, 0))!;
    assert.ok(observatory, "a coordinate clue row");
    plugin.updateClue(observatory);
    recording = new RecordingGraphics2D(metrics);
    panel.render(recording);
    assert.ok(!texts().includes("Requires Spade!"), "the inventory is unknown until a container event");
    inventory.setSnapshot([]);
    bus.post(new ItemContainerChanged(InventoryID.INV, new ItemContainer(InventoryID.INV, inventory)));
    recording = new RecordingGraphics2D(metrics);
    panel.render(recording);
    const warnings = recording.strings.filter((s) => s.text === "Requires Spade!");
    assert.ok(warnings.length > 0, `a coordinate clue without a spade warns: ${JSON.stringify(texts())}`);
    assert.ok(warnings.some((s) => s.color === argb(0xffff0000)), "in red (the other is its shadow)");
    inventory.setSlot(0, ItemID.SPADE, 1);
    bus.post(new ItemContainerChanged(InventoryID.INV, new ItemContainer(InventoryID.INV, inventory)));
    recording = new RecordingGraphics2D(metrics);
    panel.render(recording);
    assert.ok(!texts().includes("Requires Spade!"), "with a spade the warning goes");

    // --- The world overlay without scene geometry draws nothing and does not throw --------------------
    assert.equal(osrsClient.sceneGeometry, undefined);
    assert.deepEqual(world.draw(context), [], "no scene geometry (login, loading): nothing drawn");
    assert.equal(typeof world.signature(), "string");

    // --- The emote tab: the clue's emote widget is highlighted, the list scrolled to it once ----------
    const emoteClue = EmoteClue.CLUES.find((clue) => clue.getFirstEmote().hasSprite() && clue.getSecondEmote() === null)!;
    plugin.updateClue(emoteClue);
    const node = (uid: number, fields: object) => ({ uid, parentUid: -1, isHidden: false, ...fields });
    widgets.set(EMOTE_UNIVERSE, node(EMOTE_UNIVERSE, { _absX: 0, _absY: 0, _absWidth: 250, _absHeight: 300 }));
    widgets.set(EMOTE_CONTENTS, node(EMOTE_CONTENTS, { _absX: 10, _absY: 20, _absWidth: 200, _absHeight: 260 }));
    widgets.set(EMOTE_SCROLLABLE, node(EMOTE_SCROLLABLE, { _absX: 10, _absY: 20, _absWidth: 200, _absHeight: 260, height: 260, scrollHeight: 600 }));
    dynamicChildren.set(EMOTE_CONTENTS, [
        node(0, { spriteId: -1, _absX: 10, _absY: 20, _absWidth: 40, _absHeight: 40, y: 0, height: 40 }),
        node(1, { spriteId: emoteClue.getFirstEmote().getSpriteId(), _absX: 60, _absY: 100, _absWidth: 40, _absHeight: 40, y: 400, height: 40 }),
    ]);
    polylines.length = 0;
    scriptRuns.length = 0;
    emote.draw(context);
    assert.equal(polylines.length, 1, "one widget highlighted");
    const xs = polylines[0].map((p) => p[0]), ys = polylines[0].map((p) => p[1]);
    assert.deepEqual([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)], [60, 100, 100, 140], "the emote widget's rect");
    assert.deepEqual(scriptRuns, [[72, EMOTE_SCROLLBAR, EMOTE_SCROLLABLE, 290]], "UPDATE_SCROLLBAR centres the emote: 400 + 20 - 260 / 2");
    emote.draw(context);
    assert.equal(scriptRuns.length, 1, "scrolled once, not every frame");
    plugin.resetClue(true);
    emote.draw(context);
    plugin.updateClue(emoteClue);
    emote.draw(context);
    assert.equal(scriptRuns.length, 2, "a new clue scrolls again");

    // --- The world map point swaps to the plain scroll image at the map's edge ------------------------
    const scroll = { width: 36, height: 32 } as HTMLCanvasElement;
    plugin.setItemImageSource(() => scroll);
    const point = new ClueScrollWorldMapPoint(new WorldPoint(3222, 3218, 0), plugin);
    assert.equal(point.getName(), "Clue Scroll");
    assert.equal(point.isJumpOnClick(), true);
    assert.deepEqual(point.getImagePoint(), { x: 18, y: 32 }, "the arrow's tip is the anchor");
    point.onEdgeSnap();
    assert.equal(point.getImagePoint(), null, "snapped: the plain image, centred");
    point.onEdgeUnsnap();
    assert.deepEqual(point.getImagePoint(), { x: 18, y: 32 });

    // --- Client scripts that cannot run right now never abort an overlay frame ------------------------
    const busy = osrsClient.cs2Vm;
    osrsClient.cs2Vm = { ...busy, isRunning: () => true };
    plugin.resetClue(true);
    emote.draw(context);
    plugin.updateClue(emoteClue);
    scriptRuns.length = 0;
    assert.doesNotThrow(() => emote.draw(context), "a busy CS2 VM: the scroll is skipped, not thrown");
    assert.equal(scriptRuns.length, 0);
    osrsClient.cs2Vm = busy;
    emote.draw(context);
    assert.equal(scriptRuns.length, 1, "and tried again on the next frame once the VM is free");
    osrsClient.cs2Vm = { ...busy, isRunning: () => true };
    const zoo = AnagramClue.CLUES.find((c) => c.getText() === "EEK ZERO OP")!;
    assert.doesNotThrow(() => zoo.makeOverlayHint(new PanelComponent(), plugin), "the Eagles' Peak answer provider swallows a busy VM");
    const eluned = CipherClue.CLUES.find((c) => c.getText().endsWith("OVEXON"))!;
    assert.ok(eluned, "the Eluned cipher row");
    assert.doesNotThrow(() => eluned.getLocation(plugin), "Eluned's location provider swallows a busy VM");
    osrsClient.cs2Vm = busy;

    // --- The map marker composes its images once they have loaded, not only when it is made --------------
    const late = new ClueScrollWorldMapPoint(new WorldPoint(3222, 3218, 0), plugin);
    assert.equal(late.getImage(), scroll, "no arrow yet: the plain scroll");
    const arrow = { width: 20, height: 40 } as HTMLCanvasElement;
    (plugin as any).getMapArrow = () => arrow;
    assert.equal(late.getImage(), arrow, "the arrow arrived: the marker is composed on it (no canvas here, so the arrow itself)");
    assert.deepEqual(late.getImagePoint(), { x: 10, y: 40 }, "anchored at the arrow's tip");

    console.log("clue-scroll-overlays: ok");
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
