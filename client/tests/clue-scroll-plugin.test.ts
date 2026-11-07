import { strict as assert } from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { ItemContainer } from "@runelite/api/Item";
import * as InventoryID from "@runelite/api/gameval/InventoryID";
import * as ItemID from "@runelite/api/gameval/ItemID";
import { PanelComponent } from "@runelite/client/ui/overlay/components/PanelComponent";
import { BankTagsPlugin } from "../game/plugins/banktags/BankTagsPlugin";
import { ClueScrollConfig, IdentificationMode } from "../game/plugins/cluescrolls/ClueScrollConfig";
import { ClueScrollPlugin } from "../game/plugins/cluescrolls/ClueScrollPlugin";
import { WorldPoint } from "@runelite/api/coords/WorldPoint";
import * as ObjectID from "@runelite/api/gameval/ObjectID";
import { Text } from "@runelite/client/util/Text";
import { AnagramClue } from "../game/plugins/cluescrolls/clues/AnagramClue";
import { CipherClue } from "../game/plugins/cluescrolls/clues/CipherClue";
import { ClueScroll } from "../game/plugins/cluescrolls/clues/ClueScroll";
import { CrypticClue } from "../game/plugins/cluescrolls/clues/CrypticClue";
import * as InterfaceID from "@runelite/api/gameval/InterfaceID";
import { BeginnerMapClue } from "../game/plugins/cluescrolls/clues/BeginnerMapClue";
import { worldPointHashCode } from "../game/plugins/cluescrolls/clues/ClueKeys";
import { CoordinateClue } from "../game/plugins/cluescrolls/clues/CoordinateClue";
import { EmoteClue } from "../game/plugins/cluescrolls/clues/EmoteClue";
import { Emote } from "../game/plugins/cluescrolls/clues/emote/Emote";
import { STASHUnit } from "../game/plugins/cluescrolls/clues/emote/STASHUnit";
import { FairyRingClue } from "../game/plugins/cluescrolls/clues/FairyRingClue";
import { FaloTheBardClue } from "../game/plugins/cluescrolls/clues/FaloTheBardClue";
import { HotColdClue } from "../game/plugins/cluescrolls/clues/HotColdClue";
import { HotColdLocation } from "../game/plugins/cluescrolls/clues/hotcold/HotColdLocation";
import { HotColdSolver } from "../game/plugins/cluescrolls/clues/hotcold/HotColdSolver";
import { HotColdTemperature } from "../game/plugins/cluescrolls/clues/hotcold/HotColdTemperature";
import { HotColdTemperatureChange } from "../game/plugins/cluescrolls/clues/hotcold/HotColdTemperatureChange";
import { MapClue } from "../game/plugins/cluescrolls/clues/MapClue";
import { MusicClue } from "../game/plugins/cluescrolls/clues/MusicClue";
import { SkillChallengeClue } from "../game/plugins/cluescrolls/clues/SkillChallengeClue";
import { ThreeStepCrypticClue } from "../game/plugins/cluescrolls/clues/ThreeStepCrypticClue";
import { isLocationsClueScroll, isNpcClueScroll } from "../game/plugins/cluescrolls/clues/ClueScrollTypes";
import { Enemy } from "../game/plugins/cluescrolls/clues/Enemy";
import { EquipmentInventorySlot } from "../game/plugins/cluescrolls/clues/EquipmentInventorySlot";
import { all, any, emptySlot, item, range, xOfItem } from "../game/plugins/cluescrolls/clues/item/ItemRequirements";
import { Inventory } from "../rs/inventory/Inventory";

// RuneLite 1.13.6's Clue Scroll plugin: descriptor, config group and keys, and its place in the
// core plugin list (after Bank Tags, whose TagManager it registers the "clue" tags with).

// --- Descriptor --------------------------------------------------------------------------------------
const descriptor = ClueScrollPlugin.descriptor;
assert.equal(descriptor.name, "Clue Scroll");
assert.equal(descriptor.description, "Show answers to clue scroll riddles, anagrams, ciphers, and cryptic clues");
assert.deepEqual(descriptor.tags, ["arrow", "hints", "world", "map", "coordinates", "emotes"]);
assert.equal(descriptor.enabledByDefault, false, "the repository's plugin default since #2521 (RuneLite's is on)");
assert.equal(descriptor.configKey, "cluescrollplugin");
assert.equal(ClueScrollPlugin.config, ClueScrollConfig, "the hub's settings panel finds the group");

// --- Config: RuneLite's group, keys and defaults ----------------------------------------------------
assert.equal(ClueScrollConfig.group, "cluescroll");
const items = ClueScrollConfig.items;
assert.equal(items.displayHintArrows.keyName, "displayHintArrows");
assert.equal(items.displayHintArrows.name, "Display hint arrows");
assert.equal(items.displayHintArrows.default, true);
assert.equal(items.identify.keyName, "identify");
assert.equal(items.identify.name, "Identify");
assert.equal(items.identify.default, "ON_READ");
assert.deepEqual(Object.keys(IdentificationMode), ["ON_READ", "IF_INACTIVE", "ON_PICKUP"], "RuneLite's IdentificationMode, in order");
assert.equal(items.identify.enum, IdentificationMode);
assert.equal(Object.keys(items).length, 2, "two settings, as RuneLite");

// --- Registration ------------------------------------------------------------------------------------
// The core plugin list cannot be imported under Node (it pulls in every plugin, and some touch
// browser globals or syntax tsx cannot transform), so the order is checked in the list's source:
// Clue Scroll must come after Bank Tags, whose TagManager it registers its tags with.
const registry = fs.readFileSync(path.join(__dirname, "../runelite/client/plugins/index.ts"), "utf8");
const list = registry.slice(registry.indexOf("CORE_PLUGINS"), registry.indexOf("];", registry.indexOf("CORE_PLUGINS")));
const bankTagsAt = list.indexOf("    BankTagsPlugin,");
const clueAt = list.indexOf("    ClueScrollPlugin,");
assert.ok(bankTagsAt >= 0 && clueAt >= 0, "both are core plugins");
assert.ok(clueAt > bankTagsAt, "Clue Scroll is listed after Bank Tags");
void BankTagsPlugin;

// --- Item requirements over a real Inventory ----------------------------------------------------------
{
    const inventory = new Inventory(28);
    const equipment = new Inventory(14);
    const inv = () => new ItemContainer(InventoryID.INV, inventory).getItems();
    const worn = () => new ItemContainer(InventoryID.WORN, equipment).getItems();
    const client: any = { getItemDefinition: (id: number) => (id === ItemID.SPADE ? { getName: () => "Spade" } : id === ItemID.COINS ? { getName: () => "Coins" } : null) };

    const spade = item(ItemID.SPADE);
    assert.equal(spade.fulfilledBy(inv()), false, "an empty inventory has no spade");
    inventory.setSlot(3, ItemID.SPADE, 1);
    assert.equal(spade.fulfilledBy(inv()), true);
    assert.equal(spade.fulfilledBy(ItemID.SPADE), true);
    assert.equal(spade.fulfilledBy(ItemID.COINS), false);
    assert.equal(spade.getCollectiveName(client), "Spade", "the cache name");
    assert.equal(item(1).getCollectiveName(client), "N/A", "an unknown item");

    const rangeReq = range("Some range", 100, 110);
    assert.equal(rangeReq.fulfilledBy(105), true);
    assert.equal(rangeReq.fulfilledBy(111), false);
    inventory.setSlot(4, 110, 1);
    assert.equal(rangeReq.fulfilledBy(inv()), true, "the end of the range counts");
    assert.equal(rangeReq.getCollectiveName(client), "Some range");

    const tenCoins = xOfItem(ItemID.COINS, 10);
    inventory.setSlot(5, ItemID.COINS, 9);
    assert.equal(tenCoins.fulfilledBy(inv()), false, "9 of 10");
    inventory.setSlot(6, ItemID.COINS, 1);
    assert.equal(tenCoins.fulfilledBy(inv()), true, "stacks across slots add up");
    assert.equal(tenCoins.getCollectiveName(client), "Coins x10");

    const light = any("Light source", item(ItemID.TORCH_LIT), item(ItemID.LIT_CANDLE));
    assert.equal(light.fulfilledBy(inv()), false);
    inventory.setSlot(7, ItemID.LIT_CANDLE, 1);
    assert.equal(light.fulfilledBy(inv()), true, "any one of them");
    assert.equal(light.fulfilledBy(ItemID.TORCH_LIT), true);
    assert.equal(light.getCollectiveName(client), "Light source");

    const both = all(item(ItemID.SPADE), item(ItemID.TORCH_LIT));
    assert.equal(both.fulfilledBy(inv()), false, "the torch is missing");
    inventory.setSlot(8, ItemID.TORCH_LIT, 1);
    assert.equal(both.fulfilledBy(inv()), true);
    assert.equal(both.fulfilledBy(ItemID.SPADE), true, "any member matches a single id");
    assert.equal(both.getCollectiveName(client), "N/A");
    assert.equal(all("Named", item(ItemID.SPADE)).getCollectiveName(client), "Named");

    const bareHead = emptySlot("Nothing on your head", EquipmentInventorySlot.HEAD);
    assert.equal(bareHead.fulfilledBy(worn()), true, "an empty slot is Item(-1)");
    equipment.setSlot(EquipmentInventorySlot.HEAD, 1163, 1);
    assert.equal(bareHead.fulfilledBy(worn()), false);
    assert.equal(bareHead.fulfilledBy(1163), false, "a slot limitation is never met by an item id");
    assert.equal(bareHead.fulfilledBy([]), true, "a short array cannot be checked, so it passes");
    assert.equal(EquipmentInventorySlot.WEAPON, 3);
    assert.equal(EquipmentInventorySlot.AMMO, 13);
}

// --- Enemy and the clue base class ----------------------------------------------------------------------
assert.equal(Enemy.DOUBLE_AGENT_108.getText(), "Double Agent level 108");
assert.equal(Enemy.BRASSICAN_OR_WIZARDS.getText(), "Brassican Mage OR Ancient Wizards");
{
    class TestClue extends ClueScroll {
        makeOverlayHint(): void {}
        makeWorldOverlayHint(): void {}
        getConfigKeys(): number[] | null {
            return [42];
        }
    }
    const clue = new TestClue();
    assert.equal(clue.isRequiresSpade(), false);
    assert.equal(clue.isRequiresLight(), false);
    assert.equal(clue.getFirePitVarbitId(), -1);
    assert.equal(clue.getEnemy(), null);
    const panel = new PanelComponent();
    clue.renderOverlayNote(panel, { getClueNote: () => null } as any);
    assert.equal(panel.getChildren().length, 0, "no note, no lines");
    clue.renderOverlayNote(panel, { getClueNote: (key: number) => (key === 42 ? "Bring a spade" : null) } as any);
    assert.equal(panel.getChildren().length, 2, "a 'Note:' label and the note");
    assert.ok(isNpcClueScroll({ getNpcs: () => [] }));
    assert.ok(!isNpcClueScroll(clue));
    assert.ok(isLocationsClueScroll({ reset: () => {}, getLocations: () => [] }));
    assert.ok(!isLocationsClueScroll({ getLocations: () => [] }), "LocationsClueScroll also resets");
}

// --- Cryptic, anagram and cipher tables ----------------------------------------------------------------
{
    const plugin: any = { getClient: () => ({ getVarbitValue: () => 0, runScript: () => {}, getIntStack: () => [0] }) };
    assert.equal(CrypticClue.CLUES.length, 287, "RuneLite 1.13.6's cryptic rows");
    assert.equal(AnagramClue.CLUES.length, 102, "RuneLite 1.13.6's anagram rows");
    assert.equal(CipherClue.CLUES.length, 18, "RuneLite 1.13.6's cipher rows");

    const crate = CrypticClue.forText("a crate found in the tower of a church is your next location.")!;
    assert.ok(crate, "matched case-insensitively against the table's text");
    assert.ok(crate.getLocation(plugin)!.equals(new WorldPoint(2612, 3304, 1)));
    assert.deepEqual(crate.getObjectIds(), [ObjectID.CRATE2_OLD]);
    assert.equal(crate.getNpc(plugin), null);
    assert.equal(crate.isRequiresSpade(), false, "an object clue needs no spade");
    assert.deepEqual(crate.getConfigKeys(), [-2104190885], "Java's String.hashCode of the text");
    assert.equal(CrypticClue.forText(Text.sanitizeMultilineText("A crate found in the tower<br><br>of a church is your next location.").toLowerCase()), crate, "line breaks collapse to one space");
    const sherlock = CrypticClue.forText("show this to sherlock.")!;
    assert.equal(sherlock.getNpc(plugin), "Sherlock");
    assert.ok(sherlock.getItemIds().size > 1, "the elite skill scrolls share the row");
    assert.equal(CrypticClue.forText("nothing like this exists"), null);

    const baker = AnagramClue.forText(plugin, "this anagram reveals who to speak to next: a baker")!;
    assert.ok(baker);
    assert.equal(baker.getNpcs(plugin)[0], "Baraek");
    assert.equal(baker.getArea(), "Varrock square");
    assert.equal(baker.getAnswer(plugin), "5");
    assert.equal(AnagramClue.forText(plugin, "the anagram reveals who to speak to next: a baker"), baker, "the beginner prefix too");
    assert.equal(AnagramClue.forText(plugin, "how many stalls are there in varrock square?"), baker, "and the NPC's question");
    assert.deepEqual(baker.getConfigKeys(), [-1462706950]);
    assert.equal(AnagramClue.forItemId(ItemID.TRAIL_MEDIUM_ANAGRAM_EXP2), baker);

    const kebab = CipherClue.forText("the cipher reveals who to speak to next: bmj uif lfcbc tfmmfs")!;
    assert.ok(kebab);
    assert.equal(kebab.getArea(plugin), "Pollnivneach");
    assert.equal(kebab.getAnswer(), "399");
    assert.ok(kebab.getLocation(plugin)!.equals(new WorldPoint(3354, 2974, 0)));
    assert.equal(CipherClue.forText("how many coins would you need to purchase 133 kebabs from me?"), kebab);
    assert.deepEqual(kebab.getConfigKeys(), [293517585]);
}

// --- The remaining clue tables ---------------------------------------------------------------------------
{
    const plugin: any = {
        getClient: () => ({
            getVarbitValue: () => 0,
            getLocalPlayer: () => ({ getWorldLocation: () => new WorldPoint(3200, 3200, 0) }),
            getItemDefinition: () => null,
            getObjectDefinition: () => null,
        }),
    };
    assert.equal(CoordinateClue.CLUES.size, 167, "RuneLite 1.13.6's coordinate rows, keyed by location");
    assert.equal(EmoteClue.CLUES.length, 126);
    assert.equal(SkillChallengeClue.CLUES.length, 59);
    assert.equal(Object.keys(HotColdLocation.values()).length, 141);
    assert.equal(HotColdLocation.values().length, 141);
    assert.equal(MapClue.CLUES.length, 33);
    assert.equal(MusicClue.CLUES.length, 24, "6 easy, 6 medium, 10 hard and 2 elite songs");
    assert.equal(FairyRingClue.CLUES.length, 11);
    assert.equal(FaloTheBardClue.CLUES.length, 20);

    // Coordinates: by location and by item; the first row of the table.
    const gnome = CoordinateClue.forLocation(new WorldPoint(2479, 3158, 0))!;
    assert.ok(gnome);
    assert.equal(gnome.getDirections(plugin), "South of fruit tree patch, west of Tree Gnome Village.");
    assert.equal(CoordinateClue.forItemId(ItemID.TRAIL_CLUE_MEDIUM_SEXTANT005), gnome);
    assert.equal(gnome.isRequiresSpade(), true);
    assert.deepEqual(gnome.getLocations(plugin).map((p) => p.getX()), [2479], "no Prifddinas mirror");
    assert.deepEqual(gnome.getConfigKeys(), [worldPointHashCode(new WorldPoint(2479, 3158, 0))]);
    assert.equal(CoordinateClue.forLocation(new WorldPoint(1, 1, 0)), null);

    // Emotes: the table's first row.
    const beckon = EmoteClue.forText("beckon on the east coast of the kharazi jungle. beware of double agents! equip any vestment stole and a heraldic rune shield.")!;
    assert.ok(beckon);
    assert.equal(beckon.getStashUnit(), STASHUnit.NORTHEAST_CORNER_OF_THE_KHARAZI_JUNGLE);
    assert.equal(beckon.getStashUnit()!.getObjectId(), ObjectID.HH_HARD_EXP2);
    assert.equal(beckon.getFirstEmote(), Emote.BECKON);
    assert.equal(Emote.BECKON.getSpriteId(), 709, "SpriteID.Emotes.BECKON");
    assert.equal(Emote.BULL_ROARER.hasSprite(), false);
    assert.equal(beckon.getSecondEmote(), null);
    assert.equal(beckon.getEnemy(), Enemy.DOUBLE_AGENT_108);
    assert.ok(beckon.getLocation(plugin)!.equals(new WorldPoint(2954, 2933, 0)));
    assert.equal(beckon.getItemRequirements().length, 2);
    assert.equal(EmoteClue.forItemId(ItemID.TRAIL_HARD_EMOTE_EXP2), beckon);
    assert.equal(STASHUnit.LUMBRIDGE_SWAMP_CAVES.getWorldPoints().length, 2, "a STASH with two tiles");

    // Maps: by item (easy map 1), with and without an object; beginner maps by interface group.
    const champions = MapClue.forItemId(ItemID.TRAIL_CLUE_EASY_MAP001)!;
    assert.ok(champions.getLocation(plugin)!.equals(new WorldPoint(3166, 3361, 0)));
    assert.equal(champions.isRequiresSpade(), true);
    assert.deepEqual(champions.getObjectIds(), [-1]);
    const crateMap = MapClue.forItemId(ItemID.TRAIL_CLUE_MEDIUM_MAP004)!;
    assert.equal(crateMap.isRequiresSpade(), false, "a crate to search, not a dig");
    assert.deepEqual(crateMap.getObjectIds(), [ObjectID.CRATE2_OLD]);
    assert.ok(BeginnerMapClue.forWidgetID(InterfaceID.TRAIL_MAP01)!.getLocation(plugin)!.equals(new WorldPoint(3167, 3360, 0)));
    assert.equal(BeginnerMapClue.forWidgetID(InterfaceID.TRAIL_MAP11)!.getDescription(), MapClue.WIZARDS_TOWER_DIS);
    assert.equal(BeginnerMapClue.forWidgetID(InterfaceID.TRAIL_MAP11 + 1), null);

    // Music: the song in the raw text's white tag; a known song returns the table's row.
    const vision = MusicClue.forText("I'd like to hear some music.<br><br>Come and find me, and I'll play you <col=ffffff>Vision</col>.")!;
    assert.equal(vision.getSong(), "Vision");
    assert.equal(vision, MusicClue.forItemId(ItemID.TRAIL_CLUE_EASY_MUSIC001));
    assert.equal(MusicClue.forText("<col=ffffff>Not A Song</col>")!.getSong(), "Not A Song", "an unknown song still gets a clue");
    assert.equal(MusicClue.forText("no song here"), null);
    assert.deepEqual(vision.getNpcs(plugin), ["Cecilia"]);

    // Fairy rings and Falo.
    const air = FairyRingClue.forText("a i r 2 3 3 1")!;
    assert.ok(air.getLocation(plugin)!.equals(new WorldPoint(2702, 3246, 0)));
    assert.equal(air.getText().slice(0, 5), "A I R");
    assert.equal(FairyRingClue.forItemId(ItemID.TRAIL_CLUE_HARD_FAIRY002), air);
    const scimitar = FaloTheBardClue.forChatboxText("Falo the Bard", "Okay, here goes... A blood red weapon, a strong curved sword, found on the island of primate lords.")!;
    assert.ok(scimitar);
    assert.equal(scimitar.getItemRequirements()[0].getCollectiveName(plugin.getClient()), "Dragon scimitar");
    assert.equal(FaloTheBardClue.forChatboxText("Someone else", "Here goes... A blood red weapon, a strong curved sword, found on the island of primate lords."), null);
    assert.equal(FaloTheBardClue.forChatboxText("Falo the Bard", "A blood red weapon, a strong curved sword, found on the island of primate lords."), null, "needs the 'here goes' prefix");

    // Skill challenges: Sherlock's by text (completed when struck through), Charlie's by his line.
    const tecu = SkillChallengeClue.forText("catch a tecu salamander.", "catch a tecu salamander.")!;
    assert.equal(tecu.isChallengeCompleted(), false);
    assert.equal(SkillChallengeClue.forText("catch a tecu salamander.", "<str>catch a tecu salamander.</str>"), tecu);
    assert.equal(tecu.isChallengeCompleted(), true, "a struck-through task is done");
    assert.deepEqual(tecu.getNpcs(plugin), ["Sherlock"]);
    const pike = SkillChallengeClue.forChatboxText("Charlie the Tramp", "I really need a cooked pike.")!;
    assert.ok(pike);
    assert.deepEqual(pike.getNpcs(plugin), ["Charlie the Tramp"]);
    assert.equal(pike.getReturnItem()!.fulfilledBy(ItemID.PIKE), true);
    assert.equal(SkillChallengeClue.forChatboxText("Sherlock", "I really need a cooked pike."), null);

    // Three-step cryptics: parts are read from the raw text, struck-through parts are done, a torn part ticks one off.
    const a = "Buried beneath the ground, who knows where it's found.";
    const texts = CrypticClue.CLUES.slice(0, 3).map((c) => c.getText());
    const three = ThreeStepCrypticClue.forText(texts.join(" ").toLowerCase(), `<str>${texts[0]}</str><br><br>${texts[1]}<br><br>${texts[2]}`)!;
    assert.ok(three, "three table rows make a three-step clue");
    assert.deepEqual(three.getClueSteps().map((s) => s.done), [true, false, false]);
    assert.equal(ThreeStepCrypticClue.forText("x", `${texts[0]}<br><br>${texts[1]}`), null, "two parts are not enough");
    const inventory = new Inventory(28);
    inventory.setSlot(0, ItemID.TRAIL_MASTER_PART2, 1);
    assert.equal(three.update(InventoryID.INV, new ItemContainer(InventoryID.INV, inventory)), true, "part 2 found: step 2 done");
    assert.deepEqual(three.getClueSteps().map((s) => s.done), [true, true, false]);
    assert.equal(three.update(InventoryID.INV, new ItemContainer(InventoryID.INV, inventory)), false, "nothing new");
    three.reset();
    assert.deepEqual(three.getClueSteps().map((s) => s.done), [false, false, false]);
    void a;

    // Hot-cold: temperatures, changes, the solver and the clue.
    assert.equal(HotColdTemperature.getFromTemperatureSet(HotColdTemperature.MASTER_HOT_COLD_TEMPERATURES, "The device is very cold, and warmer than last time."), HotColdTemperature.VERY_COLD, "the longest matching text wins over 'cold'");
    assert.equal(HotColdTemperature.getFromTemperatureSet(HotColdTemperature.BEGINNER_HOT_COLD_TEMPERATURES, "The device is visibly shaking."), HotColdTemperature.BEGINNER_VISIBLY_SHAKING);
    assert.equal(HotColdTemperature.getFromTemperatureSet(HotColdTemperature.MASTER_HOT_COLD_TEMPERATURES, "You feel nothing."), null);
    assert.equal(HotColdTemperatureChange.of("The device is cold, but colder than last time."), HotColdTemperatureChange.COLDER);
    assert.equal(HotColdTemperatureChange.of("The device is warm, and the same temperature as last time."), HotColdTemperatureChange.SAME);
    assert.equal(HotColdTemperatureChange.of("The device is ice cold."), null, "no change clause on the first reading");
    const masterLocations = new Set(HotColdLocation.values().filter((l) => !l.isBeginnerClue()));
    const solver = new HotColdSolver(new Set(masterLocations));
    const before = masterLocations.size;
    const after = solver.signal(new WorldPoint(2860, 3562, 0), HotColdTemperature.MASTER_VISIBLY_SHAKING, null);
    assert.ok(after.size >= 1 && after.size < before, "visibly shaking at a dig spot leaves the spots within 4 tiles");
    assert.ok([...after].some((l) => l.getWorldPoint().equals(new WorldPoint(2860, 3562, 0))), "the Warriors' Guild spot itself");
    const reldo = HotColdClue.forText("buried beneath the ground, who knows where it's found. lucky for you, a man called reldo may have a clue.", ItemID.TRAIL_CLUE_BEGINNER)!;
    assert.ok(reldo);
    assert.deepEqual(reldo.getNpcs(plugin), ["Reldo"]);
    assert.equal(reldo.isBeginner(), true);
    assert.deepEqual(reldo.getLocations(plugin).map((p) => [p.getX(), p.getY()]), [[3211, 3494]], "before any reading: Reldo's tile");
    // From Lumbridge (3200, 3200) "very cold" means 200-499 tiles: Varrock's spots stay, Lumbridge's and Draynor's go.
    assert.equal(reldo.update("The device is very cold.", plugin), true, "a first reading has no change clause and still narrows");
    const beginnerSpots = HotColdLocation.values().filter((l) => l.isBeginnerClue()).length;
    assert.ok(reldo.getLocations(plugin).length > 0 && reldo.getLocations(plugin).length < beginnerSpots, `${reldo.getLocations(plugin).length} of ${beginnerSpots} spots left`);
    assert.equal(reldo.update("Nothing to do with the device.", plugin), false);
    assert.equal(HotColdClue.forText("buried beneath the ground, who knows where it's found. the league tutor may have a strange device lying around.", ItemID.TRAIL_CLUE_MASTER)!.isBeginner(), false);
}

console.log("clue-scroll-plugin: ok");
