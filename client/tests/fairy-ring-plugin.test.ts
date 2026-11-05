import assert from "node:assert/strict";
import { ConfigManager } from "../runelite/client/config/ConfigManager";
import { CLIENT_TOKEN, PluginInjector } from "../runelite/client/plugins/PluginInjector";
import { FairyRingPlugin } from "../game/plugins/fairyring/FairyRingPlugin";
import { fairyRingDestination } from "../game/plugins/fairyring/fairyRings";
import { createCacheVm } from "../scripts/cache/cs2-sweep";

assert.equal(FairyRingPlugin.descriptor.enabledByDefault, false, "fresh installs start disabled");

assert.equal(fairyRingDestination(0, 3, 2), "Slayer cave", "AJR is 0 3 2 (the dials count anticlockwise)");
assert.equal(fairyRingDestination(3, 2, 1), "Zanaris", "BKS");
assert.equal(fairyRingDestination(0, 0, 0), "Invalid location", "AIP has no destination");

const { vm } = createCacheVm();
const manager = vm.context.widgetManager;
const vars = vm.context.varManager;
const plugin = new PluginInjector(new ConfigManager(undefined))
    .provide(CLIENT_TOKEN, { widgetManager: manager, varManager: vars })
    .runWith(() => new FairyRingPlugin());
void plugin.start();
vm.context.onScriptFinished = (id: number) => plugin.onScriptFinished(id);
manager.getGroup(398);
const confirm = () => manager.getWidgetByUid((398 << 16) | 26).text;
assert.equal(confirm(), "Teleport to this location");

// The dial's own varbit listener (script 398) runs after a turn, as in game.
const turn = (left: number, middle: number, right: number) => {
    vars.setVarbit(3985, left);
    vars.setVarbit(3986, middle);
    vars.setVarbit(3987, right);
    vm.invokeEventHandler(manager.getWidgetByUid((398 << 16) | 3), "onVarTransmit");
};
turn(0, 3, 2);
assert.equal(confirm(), "Slayer cave");
turn(2, 2, 1);
assert.equal(confirm(), "Canifis", "CKS");
turn(0, 0, 0);
assert.equal(confirm(), "Invalid location");
console.log("Fairy Rings: the Confirm button names the dials' destination");
