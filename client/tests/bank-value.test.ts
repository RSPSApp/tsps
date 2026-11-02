import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { ConfigManager } from "@runelite/client/config/ConfigManager";
import { inject } from "@runelite/client/plugins/PluginInjector";
import { BankPlugin, type BankPrices } from "../game/plugins/bank/BankPlugin";
import { BANK_FILLER, createValueText, formatNumber, itemPrices, parseQuantity, valueSearch } from "../game/plugins/bank/bankValue";
import type { BankTagsClient } from "../game/plugins/banktags/bankClient";
import { Bankmain } from "../game/plugins/banktags/bankmain";
import { BankTagsPlugin } from "../game/plugins/banktags/BankTagsPlugin";
import { Layout } from "../game/plugins/banktags/tabs/Layout";
import { createScriptEvent } from "../rs/cs2/Cs2Vm";
import { assembleRs2asm } from "../rs/cs2/rs2asm";
import { Inventory } from "../rs/inventory/Inventory";
import { createCacheVm } from "../scripts/cache/cs2-sweep";

const config = inject(ConfigManager);
const clearConfig = () => {
    for (const group of ["bank", "banktags"]) {
        for (const key of config.getConfigurationKeys(`${group}.`)) config.unsetConfiguration(group, key.slice(group.length + 1));
    }
};
clearConfig();

// --- The title text: RuneLite's createValueText ------------------------------------------------

const both = { showGE: true, showHA: true, showExact: false };
assert.equal(createValueText(1_234_567, 98_765, { showGE: true, showHA: false, showExact: false }), " (1.23M)", "GE only: no label");
assert.equal(createValueText(1_234_567, 98_765, both), " (GE: 1.23M) (HA: 98.7K)");
assert.equal(createValueText(1_234_567, 98_765, { ...both, showExact: true }), " (GE: 1,234,567) (HA: 98,765)");
assert.equal(createValueText(9_999, 0, both), " (GE: 9,999)", "a zero total is left out");
assert.equal(createValueText(0, 0, both), "");
assert.equal(createValueText(5, 5, { showGE: false, showHA: true, showExact: false }), " (5)", "HA only: no label");
assert.equal(formatNumber(2_147_483_647), "2,147,483,647");

// --- Prices: coins and platinum at face value, notes as their item, placeholders not -----------

const NOTED_WHIP = 4152;
const PLACEHOLDER_WHIP = 14032;
const definitions: Record<number, { noteTemplate?: number; note?: number; placeholderTemplate?: number; placeholder?: number; price?: number }> = {
    4151: { price: 120_001 },
    4152: { price: 120_001, noteTemplate: 799, note: 4151 },
    14032: { price: 0, placeholderTemplate: 14401, placeholder: 4151 },
};
const definition = (id: number) => definitions[id];
const guide = (id: number) => (id === 4151 ? 1_500_000 : undefined);
assert.deepEqual(itemPrices(995, definition, guide), { ge: 1, ha: 1 });
assert.deepEqual(itemPrices(13204, definition, guide), { ge: 1000, ha: 1000 });
assert.deepEqual(itemPrices(NOTED_WHIP, definition, guide), { ge: 1_500_000, ha: 72_000 }, "HA is 60% of the store price, floored");
assert.deepEqual(itemPrices(PLACEHOLDER_WHIP, definition, guide), { ge: undefined, ha: 0 }, "a placeholder isn't priced as the item it stands for");
assert.equal(itemPrices(1, definition, guide).ge, undefined, "undefined while the guide prices load");

// --- Value searches: RuneLite's VALUE_SEARCH_PATTERN -------------------------------------------

assert.equal(parseQuantity("1.5m"), 1_500_000);
assert.equal(parseQuantity("20K"), 20_000);
assert.equal(parseQuantity("7"), 7);
const whips = () => ({ quantity: 3, ge: 1_500_000, ha: 72_000, placeholder: false });
const matches = (search: string) => valueSearch(whips, search);
assert.ok(matches("ge>1m"), "3 whips are 4.5M");
assert.ok(matches(">4m"), "no mode takes max(GE, HA)");
assert.ok(!matches("ge > 5m"));
assert.ok(matches("ge >= 4.5m"));
assert.ok(matches("ge<=4.5m"));
assert.ok(matches("ha=216k"));
assert.ok(matches("alch<1m"));
assert.ok(matches("qty=3"));
assert.ok(!matches("qty>3"));
assert.ok(matches("qty i=1"), "i compares one item's quantity");
assert.ok(!matches("qty i=3"));
assert.ok(matches("ge i=1.5m"), "i: one item's price");
assert.ok(matches("per 1m-2m"));
assert.ok(matches("4m - 5m"), "a range");
assert.ok(!matches("1m-2m"));
assert.ok(matches("GE>1M"), "case doesn't matter");
for (const search of ["", "whip", "ge", "ge>", "1m-", "tag:melee"]) assert.ok(!matches(search), `"${search}" isn't a value search`);
const alchWorth = () => ({ quantity: 2, ge: 0, ha: 1000, placeholder: false });
assert.ok(valueSearch(alchWorth, ">500"), "the default is max(GE, HA): 2 x 1000 HA beats no GE");
assert.ok(!valueSearch(alchWorth, "ge>0"));
const placeholder = () => ({ quantity: 1, ge: 1_500_000, ha: 72_000, placeholder: true });
assert.ok(!valueSearch(placeholder, "qty>0"), "a placeholder has no quantity value");

// --- The plugin against the real bank interface ------------------------------------------------

// CI has no server cache, so it stops after the checks above.
if (!existsSync(resolve(__dirname, "../../server/caches/caches.json"))) {
    console.log("bank value: ok (no server cache, bank interface checks skipped)");
    process.exit(0);
}

const { vm } = createCacheVm();
const manager = vm.context.widgetManager;
const bank = new Inventory(1410);
const WHIP = 4151, SHARK = 385, COINS = 995, PLATEBODY = 1127;
const quantities = new Map([[COINS, 1000], [WHIP, 2], [SHARK, 100], [PLATEBODY, 1], [BANK_FILLER, 1]]);
[...quantities].forEach(([id, quantity], slot) => bank.setSlot(slot, id, quantity));
vm.context.inventories = new Map([[95, bank], [93, new Inventory(28)], [94, new Inventory(14)]]);
manager.rootInterface = 161;
manager.onLoadListener = (_id: number, widget: any) => vm.runScriptEvent(createScriptEvent({ args: widget.onLoad, widget }), 2000000);
manager.onLoadInvoker = (widget: any) => vm.invokeEventHandler(widget, "onLoad");

const objs = vm.context.objTypeLoader;
const client: BankTagsClient = {
    widgets: manager,
    vm,
    getWidget: (id) => manager.getWidgetByUid(id),
    getItemDefinition: (id) => objs.load(id),
    canonicalize: (id) => id,
    getItemCount: () => objs.getCount(),
    getItemContainer: (id) => vm.context.inventories.get(id),
    getVarbitValue: (id) => vm.context.varManager.getVarbit(id),
    setVarbit: (id, v) => vm.context.varManager.setVarbit(id, v),
    getVarpValue: (id) => vm.context.varManager.getVarp(id),
    getVarcStrValue: (id) => String(vm.context.varManager.getVarcString(id) ?? ""),
    setVarcIntValue: (id, v) => vm.context.varManager.setVarcInt(id, v),
    setVarcStrValue: (id, v) => vm.context.varManager.setVarcString(id, v),
    getEnumIntValue: () => -1,
    runScript: (id, ...args) => vm.run(vm.context.loadScript(id), args.filter((a): a is number => typeof a === "number"), []),
    runListener: (widget, event) => vm.invokeEventHandler(widget, event),
    isShiftPressed: () => false,
    playSoundEffect: () => {},
    sendChatMessage: () => {},
    getDraggedWidget: () => undefined,
    getDraggedOnWidget: () => undefined,
    setDraggedOnWidget: () => {},
};

let guideTable: Map<number, number> | undefined;
let revision = 0;
const prices: BankPrices = {
    guidePrice: (id) => (guideTable ? guideTable.get(id) ?? 0 : undefined),
    revision: () => revision,
};
const chatbox: any = { getCurrentInput: () => undefined, close: () => {} };
const bankTags = new BankTagsPlugin(undefined, { client, configManager: config, chatboxPanelManager: chatbox });
const plugin = new BankPlugin(undefined, { client, configManager: config, prices });
// Bank Tags first, as in CORE_PLUGINS.
for (const p of [bankTags, plugin]) {
    vm.scriptCallbackListeners.add((_s: unknown, eventName: string) => p.onScriptCallback({ eventName, vm }));
    vm.scriptPostListeners.add((id: number) => p.onScriptFinished(id));
}
// The client dispatches plugin pre-script hooks before the VM's, as RuneLite's priority does, so
// Bank reads the bank's own layout before Bank Tags rearranges the tab in its listener.
vm.context.onScriptPre = (id: number) => plugin.onScriptPreFired(id);

async function main(): Promise<void> {
    await bankTags.start();
    await plugin.start();
    for (const root of manager.getAllGroupRoots(12)) manager.triggerOnLoad(root);
    const items = manager.getWidgetByUid(Bankmain.ITEMS)!;
    const build = () => vm.invokeEventHandler(items, "onInvTransmit");
    const title = () => String(manager.getWidgetByUid(Bankmain.TITLE)!.text);
    const ha = (id: number) => (id === COINS ? 1 : Math.floor(objs.load(id).price * 0.6));
    const haTotal = [...quantities].reduce((sum, [id, q]) => sum + ha(id) * q, 0);

    // The prices are still loading: coins are known, so their value shows; the rest follows.
    build();
    assert.equal(title(), "The Bank of Gielinor (1,000)");
    guideTable = new Map([[WHIP, 1_500_000], [SHARK, 900]]);
    revision++;
    plugin.onClientTick();
    assert.equal(title(), "The Bank of Gielinor (3.09M)", "1,000 + 2 x 1.5M + 100 x 900, laid out again once prices arrive");
    build();
    assert.equal(title(), "The Bank of Gielinor (3.09M)", "a rebuild doesn't add it twice");

    config.setConfigValue(BankPlugin.config, "showHA", true);
    plugin.onConfigChanged({ getGroup: () => "bank" } as any);
    build();
    assert.equal(title(), `The Bank of Gielinor (GE: 3.09M) (HA: ${createValueText(0, haTotal, { showGE: false, showHA: true, showExact: false }).slice(2, -1)})`);
    config.setConfigValue(BankPlugin.config, "showExact", true);
    build();
    assert.ok(title().startsWith("The Bank of Gielinor (GE: 3,091,000) (HA: "), title());
    config.setConfigValue(BankPlugin.config, "showHA", false);
    config.setConfigValue(BankPlugin.config, "showExact", false);

    // Value searches through bankmain_filteritem, as the build calls it while searching.
    const filter = (item: number, search: string) => {
        vm.run(vm.context.loadScript(279), [item, 1], [search]);
        return vm.intStack[0];
    };
    assert.equal(filter(WHIP, "ge>1m"), 1, "2 whips are 3M");
    assert.equal(filter(SHARK, "ge>1m"), 0);
    assert.equal(filter(SHARK, "qty>=100"), 1);
    assert.equal(filter(COINS, "1k-2k"), 1);
    assert.equal(filter(SHARK, "shark"), 1, "a name search still works");
    assert.equal(filter(BANK_FILLER, "qty>0"), 0, "bank fillers aren't items the bank holds");

    // The search box echoes the text through escape: a value search's > draws as itself.
    vm.run(assembleRs2asm(`.id 9001\n.int_arg_count 0\n.obj_arg_count 0\n   sconst "ge>1m<"\n   escape\n   return`), [], []);
    assert.equal(vm.stringStack[0], "ge<gt>1m<lt>");

    // A search shows only some items: the title's value is theirs.
    vm.context.varManager.setVarcString(359, "whip");
    const shown = () => (items.children ?? []).filter((c: any) => c && !c.hidden && c.itemId > 0).map((c: any) => c.itemId);
    build();
    assert.deepEqual(shown(), [WHIP]);
    assert.equal(title(), "Showing items: <col=ff0000>whip</col> (3M)", "only the whips' value");
    vm.context.varManager.setVarcString(359, "");

    // A placeholder stands in for the whip: it has a quantity but neither price.
    bank.setSlot(6, PLACEHOLDER_WHIP, 1);
    build();
    assert.equal(filter(PLACEHOLDER_WHIP, "ge i>1m"), 0, "a placeholder isn't priced as the item it stands for");
    assert.equal(filter(PLACEHOLDER_WHIP, "qty>0"), 0, "and has no quantity value");
    bank.setSlot(6, -1, 0);
    build();

    // A value search made while the guide prices load: the unknown prices read as zero and hide
    // everything, so the bank lays out again once the prices arrive rather than staying empty.
    guideTable = undefined;
    revision++;
    vm.context.varManager.setVarcString(359, "ge>1m");
    build();
    assert.deepEqual(shown(), [], "no guide price is known yet, so nothing matches");
    guideTable = new Map([[WHIP, 1_500_000], [SHARK, 900]]);
    revision++;
    plugin.onClientTick();
    assert.deepEqual(shown(), [WHIP], "the search matches once the prices arrive");
    assert.equal(title(), "Showing items: <col=ff0000>ge>1m</col> (3M)");
    vm.context.varManager.setVarcString(359, "");

    // A tag tab: Bank Tags' title, then the tab's value.
    bankTags.tagManager.addTag(WHIP, "melee", false);
    bankTags.tabManager.add(bankTags.tabManager.load("melee"));
    bankTags.tabManager.save();
    bankTags.openBankTag("melee");
    build();
    assert.equal(title(), "Tag tab <col=ff0000>melee</col> (3M)");
    bankTags.closeBankTag();
    build();

    // A saved layout repeats a stack and draws a missing item as a 0x7fffffff placeholder. The value
    // is the bank's own layout, taken before Bank Tags rearranges the tab.
    const MISSING = 1215;
    guideTable = new Map([[WHIP, 1_500_000], [SHARK, 900], [MISSING, 500_000]]);
    bankTags.layoutManager.saveLayout(new Layout("melee", [WHIP, WHIP, WHIP, MISSING, -1]));
    bankTags.openBankTag("melee");
    build();
    assert.equal(title(), "Tag tab <col=ff0000>melee</col> (3M)", "2 whips, not 3 stacks and a placeholder");
    bankTags.layoutManager.removeLayout("melee");
    bankTags.closeBankTag();
    build();

    // Off: the title is the bank's own again.
    await plugin.stop();
    build();
    assert.equal(title(), "The Bank of Gielinor");
    assert.equal(filter(WHIP, "ge>1m"), 0, "no value search while off");

    clearConfig();
    console.log("bank value: ok");
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
