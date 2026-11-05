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
import { ClueScroll } from "../game/plugins/cluescrolls/clues/ClueScroll";
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

console.log("clue-scroll-plugin: ok");
