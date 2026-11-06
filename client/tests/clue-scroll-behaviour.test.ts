import { strict as assert } from "node:assert";
import { ChatMessageType } from "@runelite/api/ChatMessageType";
import { WorldPoint } from "@runelite/api/coords/WorldPoint";
import { ChatMessage, CommandExecuted, ConfigChanged, GameTick, ItemContainerChanged, NpcDespawned, NpcSpawned, WidgetLoaded } from "@runelite/api/events";
import * as InventoryID from "@runelite/api/gameval/InventoryID";
import * as ItemID from "@runelite/api/gameval/ItemID";
import { ItemContainer } from "@runelite/api/Item";
import { ConfigManager } from "@runelite/client/config/ConfigManager";
import { EventBus } from "@runelite/client/eventbus/EventBus";
import { inject } from "@runelite/client/plugins/PluginInjector";
import { WorldMapPointManager } from "@runelite/client/ui/overlay/worldmap/WorldMapPointManager";
import { ClientState } from "../game/ClientState";
import { NpcEcs } from "../game/ecs/NpcEcs";
import { clearHintArrow, hintArrow } from "../game/HintArrow";
import { ClueScrollConfig } from "../game/plugins/cluescrolls/ClueScrollConfig";
import { ClueScrollPlugin } from "../game/plugins/cluescrolls/ClueScrollPlugin";
import { TRAIL_CLUETEXT_TEXT } from "../game/plugins/cluescrolls/ClueScrollInterfaces";
import { CoordinateClue } from "../game/plugins/cluescrolls/clues/CoordinateClue";
import { CrypticClue } from "../game/plugins/cluescrolls/clues/CrypticClue";
import { HotColdClue } from "../game/plugins/cluescrolls/clues/HotColdClue";
import { isNamedObjectClueScroll } from "../game/plugins/cluescrolls/clues/ClueScrollTypes";
import { SkillChallengeClue } from "../game/plugins/cluescrolls/clues/SkillChallengeClue";
import { Inventory } from "../rs/inventory/Inventory";

// RuneLite's ClueScrollPlugin behaviour, driven through its events on real stores: the clue is
// found from the scroll text or the item, follows the inventory, marks NPCs with a hint arrow,
// reads Charlie's and the strange device's lines, and resets when the scroll is gone.

// --- The stub engine -----------------------------------------------------------------------------------
const inventory = new Inventory(28);
const equipment = new Inventory(14);
const npcs = new NpcEcs(32);
const widgets = new Map<number, any>();
const npcNames: Record<number, string> = { 1: "Sherlock", 2: "Goblin", 3: "Reldo" };
const npcTypeLoader = { load: (id: number) => (npcNames[id] ? { id, name: npcNames[id], actions: [] as string[] } : undefined) };
const definitions: Record<number, { name: string; params?: Map<number, number> }> = {
    [ItemID.TRAIL_CLUE_EASY_VAGUE004]: { name: "Clue scroll (easy)", params: new Map([[623, 1]]) },
    [ItemID.TRAIL_CLUE_MEDIUM_SEXTANT005]: { name: "Clue scroll (medium)", params: new Map([[623, 2]]) },
    [ItemID.TRAIL_CLUE_EASY_SIMPLE020]: { name: "Clue scroll (easy)", params: new Map([[623, 3]]) },
    [ItemID.SPADE]: { name: "Spade" },
    [ItemID.TRAIL_CLUE_BEGINNER]: { name: "Clue scroll (beginner)" },
};
const osrsClient: any = {
    gameState: 30,
    inventory,
    equipment,
    npcEcs: npcs,
    npcTypeLoader,
    objTypeLoader: { load: (id: number) => (definitions[id] ? { id, ...definitions[id] } : undefined) },
    varManager: { getVarbit: () => 0, getVarp: () => 0 },
    widgetManager: { getWidgetByUid: (uid: number) => widgets.get(uid), getDynamicChildrenByParent: () => [] },
    inputManager: { mouseX: 0, mouseY: 0 },
    controlledPlayerServerId: 1,
    playerEcs: { getIndexForServerId: () => 0, getX: () => 3200 * 128, getY: () => 3200 * 128, getLevel: () => 0, getName: () => "Kraken", getCombatLevel: () => 3, getAnimActionSeqId: () => -1, getInteractionIndex: () => -1 },
    localPlayerName: "Kraken",
    addGameMessage: () => {},
};
ClientState.baseX = 3200;
ClientState.baseY = 3200;
ClientState.plane = 0;

const configManager = inject(ConfigManager);
const setConfig = (key: "displayHintArrows" | "identify", value: unknown) => configManager.setConfigValue(ClueScrollConfig, key as any, value);
const plugin = new ClueScrollPlugin({ client: osrsClient, configManager, chatboxPanelManager: {} as any, tagManager: undefined, worldMapPointManager: new WorldMapPointManager() });
const bus = new EventBus();
bus.register(plugin);
const container = () => new ItemContainerChanged(InventoryID.INV, new ItemContainer(InventoryID.INV, inventory));
const npcAt = (type: number, tileX: number, tileY: number, serverId: number) => {
    const ecsId = npcs.createNpc(50, 50, type, 1, (tileX - 3200) * 128 + 64, (tileY - 3200) * 128 + 64, 0, 0, tileX, tileY);
    npcs.setServerMapping(ecsId, serverId);
    return ecsId;
};

async function main(): Promise<void> {
    await plugin.start();
    clearHintArrow();

    // (a) Reading a clue: the text interface opens, its text arrives, the next tick finds the clue.
    const crate = CrypticClue.forText("a crate found in the tower of a church is your next location.")!;
    widgets.set(TRAIL_CLUETEXT_TEXT, { uid: TRAIL_CLUETEXT_TEXT, text: "A crate found in the tower of a church<br><br>is your next location.", isHidden: false });
    bus.post(new WidgetLoaded(203));
    assert.equal(plugin.getClue(), null, "not before the tick: the text may not be set yet");
    bus.post(new GameTick());
    assert.equal(plugin.getClue(), crate, "the scroll's text, line breaks collapsed");
    assert.equal(plugin.getWorldMapPointManager().getPoints().length, 1, "one world map point for the crate");
    widgets.delete(TRAIL_CLUETEXT_TEXT);

    // (f) An NPC the clue names spawns: marked, hint arrow on it; despawn clears both.
    const sherlock = CrypticClue.forText("show this to sherlock.")!;
    plugin.updateClue(sherlock);
    const sherlockEcs = npcAt(1, 3210, 3210, 11);
    bus.post(new NpcSpawned({ ecsId: sherlockEcs, index: 11, id: 1 }));
    assert.equal(plugin.getNpcsToMark().length, 1);
    assert.equal(plugin.getNpcsToMark()[0].getIndex(), 11);
    assert.equal(hintArrow.type, 1, "an NPC hint arrow");
    assert.equal(hintArrow.npcId, 11);
    const goblinEcs = npcAt(2, 3211, 3210, 12);
    bus.post(new NpcSpawned({ ecsId: goblinEcs, index: 12, id: 2 }));
    assert.equal(plugin.getNpcsToMark().length, 1, "a goblin is not Sherlock");
    bus.post(new NpcDespawned({ ecsId: sherlockEcs, index: 11, id: 1 }));
    assert.equal(plugin.getNpcsToMark().length, 0);
    assert.equal(hintArrow.type, 0, "the last marked NPC left: no arrow");

    // (b) The clue item leaves the inventory: everything resets, hint arrows included, even when they are off.
    setConfig("displayHintArrows", false);
    inventory.setSnapshot([{ slot: 0, itemId: ItemID.TRAIL_CLUE_EASY_VAGUE004, quantity: 1 }]);
    bus.post(container());
    plugin.onMenuOptionClicked({ param0: 0, param1: 0, opcode: 57, identifier: 1, itemId: ItemID.TRAIL_CLUE_EASY_VAGUE004, option: "Read", target: "Clue scroll (easy)", screenX: 0, screenY: 0 });
    assert.equal(plugin.getClue(), crate, "Read on the item finds its row by item id");
    plugin.getClient().setHintArrow(new WorldPoint(3201, 3201, 0));
    assert.equal(hintArrow.type, 2);
    inventory.setSnapshot([]);
    bus.post(container());
    assert.equal(plugin.getClue(), null, "the scroll is gone");
    assert.equal(hintArrow.type, 0, "and so is the arrow, whatever the config says");
    assert.equal(plugin.getWorldMapPointManager().getPoints().length, 0);
    setConfig("displayHintArrows", true);

    // (c) Identification modes on pickup.
    setConfig("identify", "ON_READ");
    inventory.setSnapshot([{ slot: 0, itemId: ItemID.TRAIL_CLUE_EASY_VAGUE004, quantity: 1 }]);
    bus.post(container());
    assert.equal(plugin.getClue(), null, "ON_READ: picking up does nothing");
    setConfig("identify", "IF_INACTIVE");
    inventory.setSnapshot([]);
    bus.post(container());
    inventory.setSnapshot([{ slot: 0, itemId: ItemID.TRAIL_CLUE_EASY_VAGUE004, quantity: 1 }]);
    bus.post(container());
    assert.equal(plugin.getClue(), crate, "IF_INACTIVE: a new clue with none active is picked up");
    inventory.setSlot(1, ItemID.TRAIL_CLUE_MEDIUM_SEXTANT005, 1);
    bus.post(container());
    assert.equal(plugin.getClue(), crate, "IF_INACTIVE: a second clue does not replace the active one");
    setConfig("identify", "ON_PICKUP");
    inventory.setSlot(2, ItemID.TRAIL_CLUE_EASY_SIMPLE020, 1);
    bus.post(container());
    assert.equal(plugin.getClue(), CrypticClue.forItemId(ItemID.TRAIL_CLUE_EASY_SIMPLE020), "ON_PICKUP: the newest clue takes over");
    inventory.setSlot(3, ItemID.SPADE, 1);
    bus.post(container());
    assert.equal(plugin.getClue(), CrypticClue.forItemId(ItemID.TRAIL_CLUE_EASY_SIMPLE020), "a spade has no clue row");
    inventory.setSlot(4, ItemID.TRAIL_CLUE_BEGINNER, 1);
    bus.post(container());
    assert.equal(plugin.getClue(), CrypticClue.forItemId(ItemID.TRAIL_CLUE_EASY_SIMPLE020), "a beginner clue has no row param and is left alone");
    plugin.resetClue(true);
    inventory.setSnapshot([]);
    bus.post(container());
    setConfig("identify", "ON_READ");

    // (d) Charlie's task from his dialogue, completed by the game message.
    bus.post(new ChatMessage(ChatMessageType.DIALOG, "", "Charlie the Tramp|I really need a cooked pike.", null));
    const pike = plugin.getClue() as SkillChallengeClue;
    assert.ok(pike instanceof SkillChallengeClue);
    pike.setChallengeCompleted(false);
    bus.post(new ChatMessage(ChatMessageType.GAMEMESSAGE, "", "You have completed Charlie's task, return to him.", null));
    assert.equal(pike.isChallengeCompleted(), true);
    bus.post(new ChatMessage(ChatMessageType.DIALOG, "", "Someone else|I really need a cooked pike.", null));
    assert.equal(plugin.getClue(), pike, "another speaker's line changes nothing");

    // (e) A strange device reading narrows a hot-cold clue.
    const reldo = HotColdClue.forText("buried beneath the ground, who knows where it's found. lucky for you, a man called reldo may have a clue.", ItemID.TRAIL_CLUE_BEGINNER)!;
    plugin.updateClue(reldo);
    assert.deepEqual(reldo.getLocations(plugin).map((p) => [p.getX(), p.getY()]), [[3211, 3494]], "before a reading, the only location is Reldo's");
    // From the stub's tile (3200, 3200) "warm" (100-149 squares) keeps two of the five beginner spots.
    bus.post(new ChatMessage(ChatMessageType.GAMEMESSAGE, "", "The device is warm.", null));
    assert.equal(reldo.getLocations(plugin).length, 2, "the reading narrows the dig spots");
    bus.post(new GameTick());
    assert.ok(plugin.getWorldMapPointManager().getPoints().length > 1, "one world map point per remaining spot");

    // (g) The developer command (development builds only; tests run without NODE_ENV=production).
    bus.post(new CommandExecuted("clue", "a crate found in the tower of a church is your next location.".split(" ")));
    assert.equal(plugin.getClue(), crate);
    bus.post(new CommandExecuted("clue"));
    assert.equal(plugin.getClue(), null, "::clue alone resets");

    // (h) Bank tags: the "clue" tag follows the active clue.
    plugin.updateClue(CoordinateClue.forLocation(new WorldPoint(2479, 3158, 0))!);
    assert.equal(plugin.testClueTag(ItemID.SPADE), true, "a coordinate clue wants a spade");
    assert.equal(plugin.testClueTag(ItemID.COINS), false);
    plugin.updateClue(sherlock);
    assert.equal(plugin.testClueTag(ItemID.SPADE), false, "a cryptic without a dig wants nothing");

    // Config: turning hint arrows off clears the arrow.
    plugin.getClient().setHintArrow(new WorldPoint(3201, 3201, 0));
    setConfig("displayHintArrows", false);
    bus.post(new ConfigChanged("cluescroll", "displayHintArrows", "true", "false"));
    assert.equal(hintArrow.type, 0);

    await plugin.stop();
    assert.equal(plugin.getClue(), null, "shutting down resets");
    // (i) A scene rebuild (region reload while walking) re-finds named objects, as RuneLite's
    // *ObjectSpawned handlers do on every scene load; the stale objects from the old scene go.
    const lamps = SkillChallengeClue.CLUES.find((c) => isNamedObjectClueScroll(c))!;
    plugin.updateClue(lamps);
    bus.post(new GameTick());
    plugin.getNamedObjectsToMark().add({ stale: true } as any);
    ClientState.baseX += 64;
    bus.post(new GameTick());
    bus.post(new GameTick());
    assert.equal(plugin.getNamedObjectsToMark().size, 0, "a region change drops the old scene's objects and rescans");
    plugin.resetClue(true);

    console.log("clue-scroll-behaviour: ok");
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
