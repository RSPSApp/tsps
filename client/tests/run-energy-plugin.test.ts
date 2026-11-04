import { strict as assert } from "node:assert";
import type { WorldPoint } from "@runelite/api/Client";
import { ChatMessage, ConfigChanged } from "@runelite/api/events";
import {
    GRACEFUL_BOOTS,
    GRACEFUL_CAPE,
    GRACEFUL_GLOVES,
    GRACEFUL_HOOD,
    GRACEFUL_LEGS,
    GRACEFUL_TOP,
    RING_OF_ENDURANCE,
    SKILLCAPE_AGILITY,
} from "@runelite/api/gameval/ItemID";
import { STAMINA_ACTIVE } from "@runelite/api/gameval/VarbitID";
import { ConfigManager } from "@runelite/client/config/ConfigManager";
import { EventBus } from "@runelite/client/eventbus/EventBus";
import { inject } from "@runelite/client/plugins/PluginInjector";
import { TooltipManager } from "@runelite/client/ui/overlay/tooltip/TooltipManager";
import { RunEnergyConfig } from "../game/plugins/runenergy/RunEnergyConfig";
import { RunEnergyPlugin } from "../game/plugins/runenergy/RunEnergyPlugin";
import { ChatHistoryStore } from "../rs/cs2/ChatHistory";

// --- Config: RuneLite's group, keys and defaults -------------------------------------------------
assert.equal(RunEnergyConfig.group, "runenergy");
assert.equal(RunEnergyConfig.items.ringOfEnduranceChargeMessage.default, true);
assert.equal(RunEnergyConfig.items.replaceOrbText.default, false);
assert.equal(RunEnergyPlugin.descriptor.enabledByDefault, undefined, "on by default, as RuneLite");

let energy = 10000;
let agility = 1;
let weight = 0;
let stamina = 0;
let worn: number[] = new Array(14).fill(-1);
let location: WorldPoint = { x: 3222, y: 3218, plane: 0 };
let destination = false;
let overOrb = false;
const chat: string[] = [];
const orbText: string[] = [];
const tooltips = new TooltipManager();
const history = new ChatHistoryStore();
const plugin = new RunEnergyPlugin({
    getEnergy: () => energy,
    getBoostedSkillLevel: () => agility,
    getVarbitValue: (id) => (id === STAMINA_ACTIVE ? stamina : 0),
    getLocalPlayer: () => ({ getWorldLocation: () => location } as any),
    getWeight: () => weight,
    getWornItems: () => worn,
    hasDestination: () => destination,
    isMouseOverRunOrb: () => overOrb,
    getAccount: () => "tester",
    sendChatMessage: (m) => chat.push(m),
    setRunOrbText: (t) => orbText.push(t),
}, tooltips, history);
const config = inject(ConfigManager);
void plugin.start();

// --- Run time: RuneLite's depletion per tick, energy units of 1/100 % ----------------------------
// (60 + 0) * (1 - 1/300) = 59.8 -> 59 units a tick; ceil(10000 / 59) = 170 ticks = 102 s.
assert.equal(plugin.getEstimatedRunTimeRemaining(false), "1:42");
assert.equal(plugin.getEstimatedRunTimeRemaining(true), "102s");
weight = 64;
agility = 99;
// (60 + 67) * (1 - 99/300) = 85.09 -> 85; ceil(10000/85) = 118 ticks = 70.8 s.
assert.equal(plugin.getEstimatedRunTimeRemaining(false), "1:10");
weight = 200;
assert.equal(plugin.getEstimatedRunTimeRemaining(false), "1:10", "over 64 kg counts as 64");
weight = -10;
agility = 1;
assert.equal(plugin.getEstimatedRunTimeRemaining(false), "1:42", "negative weight counts as 0");
weight = 0;
stamina = 1;
// 59 * 0.3 = 17.7 -> 17; ceil(10000/17) = 589 ticks = 353.4 s.
assert.equal(plugin.getEstimatedRunTimeRemaining(false), "5:53", "a stamina potion: 30%");
stamina = 0;

// --- Ring of endurance: unknown charges until its messages say ----------------------------------
worn[12] = RING_OF_ENDURANCE;
assert.ok(plugin.isRingOfEnduranceEquipped());
assert.equal(plugin.getEstimatedRunTimeRemaining(false), "?");
history.addMessage(0, "Your Ring of endurance is charged with 1,000 stamina doses.");
assert.equal(plugin.getRingOfEnduranceCharges(), 1000);
// 59 * 0.85 = 50.15 -> 50; 200 ticks = 120 s.
assert.equal(plugin.getEstimatedRunTimeRemaining(false), "2:00", "500 or more charges: 85%");
history.addMessage(0, "You load your Ring of endurance with 499 stamina doses.");
assert.equal(plugin.getRingOfEnduranceCharges(), 499);
assert.equal(plugin.getEstimatedRunTimeRemaining(false), "1:42", "fewer: no passive effect");
history.addMessage(0, "Your Ring of endurance doubles the duration of your stamina potion's effect.");
assert.equal(plugin.getRingOfEnduranceCharges(), 498, "a doubled stamina dose uses a charge");
assert.equal(chat.length, 1, "warned once below 500");
assert.match(chat[0], /less than 500 charges/);
history.addMessage(0, "Your Ring of endurance doubles the duration of your stamina potion's effect.");
assert.equal(chat.length, 1);
history.addMessage(2, "Your Ring of endurance is charged with 5 stamina doses.", "Someone");
assert.equal(plugin.getRingOfEnduranceCharges(), 497, "only game messages count");

// The running client both inserts chat history and posts RuneLite-shaped events.
const bus = new EventBus();
bus.register(plugin);
const errors: unknown[][] = [];
const originalError = console.error;
console.error = (...args: unknown[]) => errors.push(args);
try {
    const message = (type: number, text: string) => {
        history.addMessage(type, text);
        bus.post(new ChatMessage(type, "", text, null));
    };
    message(0, "Welcome to Old School RuneScape.");
    message(0, "Your Ring of endurance is charged with 500 stamina doses.");
    assert.equal(plugin.getRingOfEnduranceCharges(), 500);
    const warnings = chat.length;
    message(0, "Your Ring of endurance doubles the duration of your stamina potion's effect.");
    assert.equal(plugin.getRingOfEnduranceCharges(), 499, "one game message consumes exactly one charge");
    assert.equal(chat.length, warnings + 1, "crossing 500 warns exactly once");
    message(105, "Your Ring of endurance doubles the duration of your stamina potion's effect.");
    assert.equal(plugin.getRingOfEnduranceCharges(), 498, "spam messages still update charges once");
    assert.equal(chat.length, warnings + 1, "further charges do not repeat the warning");
    message(2, "Your Ring of endurance is charged with 5 stamina doses.");
    assert.equal(plugin.getRingOfEnduranceCharges(), 498, "public chat cannot set ring charges");
    assert.deepEqual(errors, [], "ordinary and ring messages must not throw in the EventBus subscriber");
} finally {
    console.error = originalError;
    bus.unregister(plugin);
}
worn[12] = -1;

// --- Recovery: 25 + Agility/6 units a second, graceful pieces boost it ---------------------------
energy = 5000;
// (10000 - 5000) / (25 + 1/6) = 198.7 s.
assert.equal(plugin.getEstimatedRecoverTimeRemaining(), 198);
worn = new Array(14).fill(-1);
worn[0] = GRACEFUL_HOOD;
worn[4] = GRACEFUL_TOP;
// 3 + 4 = 7 %: 5000 / (25.1667 * 1.07) = 185.7 s.
assert.equal(plugin.getEstimatedRecoverTimeRemaining(), 185);
worn[7] = GRACEFUL_LEGS;
worn[9] = GRACEFUL_GLOVES;
worn[10] = GRACEFUL_BOOTS;
worn[1] = SKILLCAPE_AGILITY;
// The full set (the Agility cape counts as the graceful cape): 20 + 10 = 30 %.
assert.equal(plugin.getEstimatedRecoverTimeRemaining(), Math.trunc(5000 / ((25 + 1 / 6) * 1.3)));
worn[1] = GRACEFUL_CAPE + 1;
assert.equal(plugin.getEstimatedRecoverTimeRemaining(), Math.trunc(5000 / ((25 + 1 / 6) * 1.3)),
    "item variations count (a recoloured cape)");

// Running to a destination: no recovery estimate.
destination = true;
plugin.onGameTick();
location = { x: 3224, y: 3218, plane: 0 };
plugin.onGameTick();
assert.equal(plugin.getEstimatedRecoverTimeRemaining(), -1);
plugin.onGameTick();
assert.ok(plugin.getEstimatedRecoverTimeRemaining() > 0, "standing still again");
destination = false;

// --- The tooltip over the run orb -----------------------------------------------------------------
assert.deepEqual(tooltips.getTooltips(), [], "only over the orb");
overOrb = true;
energy = 10000;
assert.deepEqual(tooltips.getTooltips().map((t) => t.text), ["Weight: 0 kg</br>Run Time Remaining: 1:42"]);
energy = 9000;
const recovered = Math.trunc(1000 / ((25 + 1 / 6) * 1.3));
assert.deepEqual(tooltips.getTooltips().map((t) => t.text),
    [`Weight: 0 kg</br>Run Time Remaining: 1:31</br>100% Energy In: 0:${String(recovered).padStart(2, "0")}`]);

// --- The orb text ---------------------------------------------------------------------------------
plugin.onScriptFinished(447);
assert.deepEqual(orbText, [], "only with Replace orb text");
config.setConfigValue(RunEnergyConfig, "replaceOrbText", true);
plugin.onScriptFinished(447);
assert.deepEqual(orbText, ["91s"]);
assert.match(tooltips.getTooltips()[0].text, /Run Energy: 90%/, "the tooltip shows the energy instead");
config.setConfigValue(RunEnergyConfig, "replaceOrbText", false);
plugin.onConfigChanged(new ConfigChanged("runenergy", "replaceOrbText", "true", "false"));
assert.deepEqual(orbText, ["91s", "90"], "back to the energy");

void plugin.stop();
assert.deepEqual(tooltips.getTooltips(), [], "shutDown removes the tooltip");
assert.equal(history.beforeInsertListeners.size, 0);
const stoppedCharges = plugin.getRingOfEnduranceCharges();
history.addMessage(0, "Your Ring of endurance is charged with 5 stamina doses.");
assert.equal(plugin.getRingOfEnduranceCharges(), stoppedCharges, "stopped plugins no longer consume chat");

console.log("Run Energy plugin tests passed");
