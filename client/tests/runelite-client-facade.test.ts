import { strict as assert } from "node:assert";
import fs from "node:fs";
import path from "node:path";
import * as EnumID from "@runelite/api/EnumID";
import * as ParamID from "@runelite/api/ParamID";
import * as ScriptID from "@runelite/api/ScriptID";
import { MenuAction } from "@runelite/api/MenuAction";
import { WorldPoint } from "@runelite/api/coords/WorldPoint";
import * as InventoryID from "@runelite/api/gameval/InventoryID";
import * as ItemID from "@runelite/api/gameval/ItemID";
import { ClientState } from "../game/ClientState";
import { NpcEcs } from "../game/ecs/NpcEcs";
import { clearHintArrow, hintArrow, setHintArrowTile } from "../game/HintArrow";
import { CacheSystem } from "../rs/cache/CacheSystem";
import { getCacheLoaderFactory } from "../rs/cache/loader/CacheLoaderFactory";
import { VarManager } from "../rs/config/vartype/VarManager";
import { Inventory } from "../rs/inventory/Inventory";
import { ClientImpl } from "../runelite/impl/ClientImpl";
import { loadCache, loadCacheInfos, loadCacheList } from "../scripts/cache/load-util";

// The RuneLite Client facade additions the Clue Scroll port reads: widgets, item containers,
// item/enum/object definitions (with multiloc impostors), NPCs, the plane, the mouse and hint
// arrows. Definitions come from the real installed cache (server/caches); without one, as on CI,
// the definition sections are skipped and said so, and the rest still runs.

const CACHES_JSON = path.resolve(__dirname, "../../server/caches/caches.json");
const hasCache = fs.existsSync(CACHES_JSON) && !process.env.RL_TEST_NO_CACHE;
const factory: any = hasCache
    ? (() => {
          const info = loadCacheList(loadCacheInfos()).latest;
          return getCacheLoaderFactory(info, CacheSystem.fromFiles(info, loadCache(info).files));
      })()
    : undefined;
const varManager: any = factory ? new VarManager(factory.getVarBitTypeLoader()) : { getVarbit: () => 0, getVarp: () => 0 };
if (!hasCache) console.log("runelite-client-facade: no server/caches, definition sections skipped");

// --- Constants -------------------------------------------------------------------------------------
assert.equal(ParamID.CLUE_SCROLL, 623);
assert.equal(ScriptID.UPDATE_SCROLLBAR, 72);
assert.equal(EnumID.RUNEPOUCH_RUNE, 982);
assert.equal(EnumID.POH_COSTUME_CLUE_MASTER, 3298);
assert.equal(MenuAction.RUNELITE_OVERLAY, 1501);
assert.equal(MenuAction.RUNELITE_OVERLAY_CONFIG, 1502);

// --- WorldPoint ------------------------------------------------------------------------------------
const lumbridge = new WorldPoint(3222, 3218, 0);
assert.equal(lumbridge.getX(), 3222);
assert.equal(lumbridge.getRegionID(), 12850, "Lumbridge's region");
assert.equal(lumbridge.distanceTo(new WorldPoint(3225, 3214, 0)), 4, "Chebyshev distance, as RuneLite");
assert.equal(lumbridge.distanceTo(new WorldPoint(3222, 3218, 1)), Number.MAX_SAFE_INTEGER, "another plane is unreachable");
assert.ok(lumbridge.equals(new WorldPoint(3222, 3218, 0)));
assert.ok(!lumbridge.equals(new WorldPoint(3222, 3219, 0)));
assert.equal(WorldPoint.getMirrorPoint(lumbridge, true), lumbridge, "a point outside Prifddinas is its own mirror");
assert.equal(WorldPoint.getMirrorPoint(lumbridge, false), lumbridge);
// RuneLite's mirror is the Prifddinas pair of regions: the real city (12894) and its overworld map copy (8755).
const prif = new WorldPoint(3210, 6020, 0);
assert.equal(prif.getRegionID(), 12894);
const overworld = WorldPoint.getMirrorPoint(prif, true);
assert.deepEqual([overworld.getX(), overworld.getY(), overworld.getPlane()], [2186, 3268, 0], "same offset in region 8755");
assert.ok(WorldPoint.getMirrorPoint(overworld, false).equals(prif), "and back again");
assert.equal(WorldPoint.getMirrorPoint(prif, false), prif, "the real city is not an overworld point");
assert.deepEqual(WorldPoint.fromRegion(12850, 22, 50, 0), new WorldPoint(3222, 3250, 0), "3222 is 22 into region 12850's 64 tiles");

// --- The stub engine ------------------------------------------------------------------------------
const inventory = new Inventory(28);
const equipment = new Inventory(14);
const widgets = new Map<number, any>();
const npcs = new NpcEcs(16);
const npcTypeLoader = factory ? factory.getNpcTypeLoader() : { load: (id: number) => (id === 655 ? { id, name: "Goblin", actions: [] } : undefined) };
const client: any = {
    objTypeLoader: factory?.getObjTypeLoader(),
    enumTypeLoader: factory?.getEnumTypeLoader(),
    locTypeLoader: factory?.getLocTypeLoader(),
    npcTypeLoader,
    varManager,
    inventory,
    equipment,
    bankInventory: new Inventory(816),
    npcEcs: npcs,
    widgetManager: {
        getWidgetByUid: (uid: number) => widgets.get(uid),
        getDynamicChildrenByParent: (node: any) => node.dynamic ?? [],
        getStaticChildrenByParentUid: (uid: number) => widgets.get(uid)?.children ?? [],
    },
    inputManager: { mouseX: 40, mouseY: 60 },
    controlledPlayerServerId: -1,
    playerEcs: { getIndexForServerId: () => undefined },
};
const facade = new ClientImpl(client);

// --- Item definitions and params (real cache) -------------------------------------------------------
if (hasCache) {
const clue = facade.getItemDefinition(ItemID.TRAIL_EASY_SIMPLE_EXP6)!;
assert.equal(clue.getId(), ItemID.TRAIL_EASY_SIMPLE_EXP6);
assert.equal(clue.getName(), "Clue scroll (easy)");
assert.notEqual(clue.getIntValue(ParamID.CLUE_SCROLL), -1, "a per-step clue item links to its clue-helper row through param 623");
// Beginner and master clues are one item each with no row param, which is why RuneLite special-cases them.
assert.equal(facade.getItemDefinition(ItemID.TRAIL_CLUE_MASTER)!.getName(), "Clue scroll (master)");
assert.equal(facade.getItemDefinition(ItemID.TRAIL_CLUE_MASTER)!.getIntValue(ParamID.CLUE_SCROLL), -1);
assert.equal(facade.getItemDefinition(ItemID.SPADE)!.getIntValue(ParamID.CLUE_SCROLL), -1, "a spade has no clue row");
assert.equal(facade.getItemDefinition(-1), null);
assert.equal(facade.getItemDefinition(ItemID.COINS)!.isStackable(), true, "coins always stack");
assert.equal(facade.getItemDefinition(ItemID.SPADE)!.isStackable(), false);
assert.equal(facade.getItemDefinition(4587)!.isMembers(), true, "a dragon scimitar is members");
assert.equal(facade.getItemDefinition(ItemID.SPADE)!.isMembers(), false);
const lobster = facade.getItemDefinition(379)!;
assert.equal(lobster.getLinkedNoteId(), 380, "an unnoted item links to its note");
assert.equal(lobster.getNote(), -1, "and is not itself a note");
assert.equal(facade.getItemDefinition(380)!.getLinkedNoteId(), 379, "the note links back");
assert.notEqual(facade.getItemDefinition(380)!.getNote(), -1, "a note has a note template");

// --- Enums -----------------------------------------------------------------------------------------
const runes = facade.getEnum(EnumID.RUNEPOUCH_RUNE)!;
assert.equal(runes.getIntValue(1), ItemID.AIRRUNE, "rune pouch type 1 is an air rune");
assert.equal(runes.getIntValue(99999), -1, "a missing key gives the default");
assert.ok(runes.getIntVals().includes(ItemID.AIRRUNE));
assert.ok(runes.getKeys().length > 10);

// --- Object definitions and impostors --------------------------------------------------------------
let multilocId = -1;
for (let id = 0; id < 5000 && multilocId < 0; id++) {
    const loc = client.locTypeLoader.load(id);
    const transforms: number[] | undefined = loc?.transforms;
    if (transforms && transforms.length > 1 && transforms[transforms.length - 1] >= 0) multilocId = id;
}
assert.ok(multilocId >= 0, "the cache has a multiloc with a default form");
const multiloc = facade.getObjectDefinition(multilocId)!;
assert.equal(multiloc.getId(), multilocId);
assert.ok(multiloc.getImpostorIds()!.length > 1);
const impostor = multiloc.getImpostor()!;
assert.ok(multiloc.getImpostorIds()!.includes(impostor.getId()), "the impostor is one of the forms");
assert.equal(typeof impostor.getName(), "string");
const plain = facade.getObjectDefinition(1276)!; // a tree
assert.equal(plain.getImpostorIds(), null);
assert.equal(plain.getImpostor(), null);
} else {
    assert.equal(facade.getItemDefinition(ItemID.SPADE), null, "no loaders: no definitions");
    assert.equal(facade.getEnum(EnumID.RUNEPOUCH_RUNE), null);
    assert.equal(facade.getObjectDefinition(1276), null);
}

// --- Widgets -----------------------------------------------------------------------------------------
const TRAIL_CLUETEXT_TEXT = (203 << 16) | 2;
widgets.set(TRAIL_CLUETEXT_TEXT, {
    uid: TRAIL_CLUETEXT_TEXT, groupId: 203, text: "Show this to Sherlock.", isHidden: false,
    _absX: 100, _absY: 50, _absWidth: 300, _absHeight: 200, width: 300, height: 200, y: 7,
    scrollY: 0, scrollHeight: 0, spriteId: -1, itemId: -1, itemQuantity: 0,
    dynamic: [{ uid: 99, text: "Yes", spriteId: 715, itemId: -1, isHidden: false, _absX: 1, _absY: 2, _absWidth: 3, _absHeight: 4, width: 3, height: 4, y: 0 }],
});
const text = facade.getWidget(TRAIL_CLUETEXT_TEXT)!;
assert.equal(text.getId(), TRAIL_CLUETEXT_TEXT);
assert.equal(text.getText(), "Show this to Sherlock.");
assert.deepEqual(text.getCanvasLocation(), { x: 100, y: 50 });
assert.equal(text.getWidth(), 300);
assert.equal(text.getHeight(), 200);
assert.equal(text.getRelativeY(), 7);
assert.equal(text.isHidden(), false);
assert.equal(text.getDynamicChildren().length, 1);
assert.equal(text.getDynamicChildren()[0].getSpriteId(), 715);
assert.equal(text.getDynamicChildren()[0].getText(), "Yes");
assert.equal(facade.getWidget((203 << 16) | 1), null, "an unloaded component is null");

// --- Item containers ---------------------------------------------------------------------------------
inventory.setSlot(2, ItemID.SPADE, 1);
assert.ok(facade.getItemContainer(InventoryID.INV)!.contains(ItemID.SPADE));
assert.equal(facade.getItemContainer(InventoryID.WORN)!.getItems().length, 14);
assert.equal(facade.getItemContainer(12345), null);

// --- Plane, mouse ------------------------------------------------------------------------------------
ClientState.plane = 2;
assert.equal(facade.getPlane(), 2);
ClientState.plane = 0;
assert.deepEqual(facade.getMouseCanvasPosition(), { x: 40, y: 60 });

// --- NPCs ----------------------------------------------------------------------------------------------
const GOBLIN = 655;
const goblin = npcs.createNpc(50, 50, GOBLIN, 1, (3245 - 3200) * 128 + 64, (3245 - 3200) * 128 + 64, 0, 0, 3245, 3245);
npcs.setServerMapping(goblin, 42);
const list = facade.getNpcs();
assert.equal(list.length, 1);
assert.equal(list[0].getIndex(), 42, "RuneLite's NPC index is the server id");
assert.equal(list[0].getId(), GOBLIN);
assert.equal(list[0].getName(), npcTypeLoader.load(GOBLIN).name);
const where = list[0].getWorldLocation();
assert.ok(where instanceof WorldPoint);

// --- Hint arrows --------------------------------------------------------------------------------------
facade.clearHintArrow();
assert.equal(facade.getHintArrowNpc(), null);
facade.setHintArrow(new WorldPoint(3200, 3201, 1));
assert.equal(hintArrow.type, 2, "a tile hint");
assert.equal(hintArrow.x, 3200);
assert.equal(hintArrow.y, 3201);
assert.equal(hintArrow.plane, 1);
facade.setHintArrow(list[0]);
assert.equal(hintArrow.type, 1, "an NPC hint");
assert.equal(hintArrow.npcId, 42);
assert.equal(facade.getHintArrowNpc()!.getIndex(), 42);
facade.clearHintArrow();
assert.equal(hintArrow.type, 0);
assert.equal(facade.getHintArrowNpc(), null);
// A hint the server set (the engine's own call) is not this plugin layer's to clear.
setHintArrowTile(3300, 3300, 100, 2 << 2);
facade.clearHintArrow();
assert.equal(hintArrow.type, 2, "the server's arrow stays");
facade.setHintArrow(new WorldPoint(3301, 3301, 0));
assert.equal(hintArrow.x, 3301, "a plugin arrow replaces it");
facade.clearHintArrow();
assert.equal(hintArrow.type, 0, "and is cleared again");
clearHintArrow();

// --- isInScene -----------------------------------------------------------------------------------------
ClientState.baseX = 3200;
ClientState.baseY = 3200;
assert.ok(new WorldPoint(3250, 3250, 0).isInScene(facade));
assert.ok(!new WorldPoint(3199, 3250, 0).isInScene(facade));
assert.ok(!new WorldPoint(3250, 3200 + 104, 0).isInScene(facade));

console.log("runelite-client-facade: ok");
