import { strict as assert } from "node:assert";

import { StatChanged } from "@runelite/api/events";
import { ConfigManager } from "@runelite/client/config/ConfigManager";
import { inject } from "@runelite/client/plugins/PluginInjector";
import { OverlayPosition } from "@runelite/client/ui/overlay/OverlayPosition";
import type { WidgetOverlayDrawContext } from "../game/plugins/ClientPluginManager";
import { StatusInfoPosition } from "../game/plugins/statusinfo/StatusInfoConfig";
import { formatQuantity, formatTimerSeconds, statusInfoScale } from "../game/plugins/statusinfo/StatusInfoOverlay";
import { POISON_TIMER_SECONDS_VARP, POISON_TIMER_TYPE_VARP, StatusInfoPlugin } from "../game/plugins/statusinfo/StatusInfoPlugin";
import { ITEM_TIMER_FIRST_VARP, POISON_SPRITES } from "../game/plugins/statustimer/timerIcons";
import { VENGEANCE_TIME_LIMIT_VARBIT } from "../game/plugins/vengeancetimer/VengeanceTimer";
import { EquipmentDisplaySlot } from "../rs/config/player/Equipment";
import { skillIconSprite } from "../rs/skill/skillIcons";
import { SkillId } from "../rs/skill/skills";

// Status Info: the game's buff bar as an overlay. Its formatting, timers read from their varps (so
// it works with the Timers plugin off), stat boosts with their bars, the ammo left, and its layout.

(globalThis as any).window = { addEventListener() {}, removeEventListener() {} };

assert.equal(formatTimerSeconds(45), "45s", "the buff bar's seconds");
assert.equal(formatTimerSeconds(60), "1:00");
assert.equal(formatTimerSeconds(299), "4:59");
// The ammo count as the buff bar shows it, never more than there is.
assert.equal(formatQuantity(950), "950");
assert.equal(formatQuantity(5236), "5.2k");
assert.equal(formatQuantity(9999), "9.9k");
assert.equal(formatQuantity(52_400), "52k");
assert.equal(formatQuantity(1_250_000), "1.2m");
assert.equal(statusInfoScale(150), 1.5);
assert.equal(statusInfoScale(9000), 4, "at most 400%");
assert.equal(statusInfoScale(10), 0.5, "at least 50%");
assert.equal(statusInfoScale("x"), 1, "the default, 100%");

const config = inject(ConfigManager);
const setOption = (key: string, value: string) => config.setConfiguration("statusinfo", key, value);

const plugin = new StatusInfoPlugin();
plugin.setEnabledState(true);
let tick = 1000, preserve = 0, attack = 0;
const varps = new Map<number, number>();
const varbits = new Map<number, number>();
const levels = new Map<SkillId, { boosted: number; real: number }>([[SkillId.Ranged, { boosted: 99, real: 99 }]]);
const worn = new Map<number, { itemId: number; quantity: number }>();
plugin.game = {
    varp: (id) => varps.get(id) ?? 0,
    varbit: (id) => (id === 5466 ? preserve : varbits.get(id) ?? 0), // 5466: Preserve
    levels: (skill) => levels.get(skill) ?? { boosted: 1, real: 1 },
    worn: (slot) => worn.get(slot),
    // Dragon arrows' stack pictures: 2+ and 5+ (made-up ids for the test).
    stackIcon: (itemId, quantity) => (itemId === 11212 ? (quantity >= 5 ? 91212 : quantity >= 2 ? 81212 : itemId) : itemId),
    tick: () => tick,
    attackTicks: () => attack,
};
const keys = () => plugin.timerEntries(now).map((e) => [e.key, e.text]);
const now = Date.now();

// Timers, read from their varps by the plugin itself.
assert.deepEqual(keys(), [], "nothing running");
varps.set(POISON_TIMER_SECONDS_VARP, 18).set(POISON_TIMER_TYPE_VARP, 1);
varps.set(ITEM_TIMER_FIRST_VARP, 300).set(ITEM_TIMER_FIRST_VARP + 1, 23685); // divine super combat, 5:00
varps.set(ITEM_TIMER_FIRST_VARP + 6, 42).set(ITEM_TIMER_FIRST_VARP + 7, -1305); // Mark of Darkness: minus its sprite
varbits.set(VENGEANCE_TIME_LIMIT_VARBIT, 1);
attack = 3;
plugin.syncTimers(now);
assert.deepEqual(keys(), [["poison", "18s"], ["vengeance", "30s"], ["attack", "3"], ["item0:23685", "5:00"], ["item3:-1305", "42s"]],
    "status timers, vengeance, the attack timer, then the item timers in slot order");
assert.equal(plugin.timerEntries(now)[0].sprite, POISON_SPRITES[1]);
setOption("showTimers", "false");
assert.deepEqual(keys(), [["attack", "3"]], "timers off: the attack timer has its own option");
setOption("showAttackTimer", "false");
assert.deepEqual(keys(), []);
setOption("showTimers", "true");
setOption("showAttackTimer", "true");
varps.clear();
varbits.clear();
attack = 0;
plugin.syncTimers(now + 1000);
assert.deepEqual(plugin.timerEntries(now + 1000), [], "cleared varps leave no boxes");

// Stat boosts.
const stat = (boosted: number, real = 99) => {
    plugin.onStatChanged(new StatChanged(SkillId.Ranged, 0, real, boosted));
    levels.set(SkillId.Ranged, { boosted, real });
};
assert.deepEqual(plugin.boostEntries(), [], "nothing boosted");
stat(112); // a divine ranging potion: +13
assert.deepEqual(plugin.boostEntries(), [{ key: `boost:${SkillId.Ranged}`, sprite: skillIconSprite(SkillId.Ranged), text: "112", restore: 1, boost: 1 }],
    "the boosted level; until a restore is seen its bar is full");
tick += 30;
stat(111); // a restore
tick += 25;
const [ranged] = plugin.boostEntries();
assert.equal(ranged.text, "111");
assert.equal(ranged.restore, 0.75, "a quarter of the minute to the next restore has gone");
assert.equal(ranged.boost, 12 / 13, "the boost left, out of the most it reached");
preserve = 1;
assert.equal(plugin.boostEntries()[0].restore, 1 - 25 / 150, "Preserve: every 150 ticks");
preserve = 0;
stat(115); // a stronger potion: the most it reached grows
assert.equal(plugin.boostEntries()[0].boost, 1);
stat(99);
assert.deepEqual(plugin.boostEntries(), [], "back to normal");
stat(90);
assert.deepEqual(plugin.boostEntries(), [], "drained, not boosted");
stat(105);
setOption("showBoosts", "false");
assert.deepEqual(plugin.boostEntries(), [], "the option off");
setOption("showBoosts", "true");

// The ammo left.
assert.equal(plugin.ammoEntry(), undefined, "nothing worn");
worn.set(EquipmentDisplaySlot.WEAPON, { itemId: 11230, quantity: 1 });
assert.equal(plugin.ammoEntry(), undefined, "one weapon is no ammo");
worn.set(EquipmentDisplaySlot.WEAPON, { itemId: 11230, quantity: 812 }); // dragon darts
assert.deepEqual(plugin.ammoEntry(), { key: "ammo:11230", item: 11230, fallback: "A", text: "812" }, "thrown weapons");
worn.set(EquipmentDisplaySlot.AMMO, { itemId: 11212, quantity: 1 });
assert.equal(plugin.ammoEntry()?.item, 11212, "one arrow is one arrow");
worn.set(EquipmentDisplaySlot.AMMO, { itemId: 11212, quantity: 5236 }); // dragon arrows
assert.deepEqual(plugin.ammoEntry(), { key: "ammo:11212", item: 91212, fallback: "A", text: "5.2k" },
    "the ammo slot first, shown as the game's picture of that big a stack");
assert.deepEqual(keys(), [["ammo:11212", "5.2k"]], "after the timers");
setOption("showAmmo", "false");
assert.equal(plugin.ammoEntry(), undefined, "the option off");
setOption("showAmmo", "true");

// Layout at 100%: the boost (its 10-unit bar strip, a shadow, the 34-unit box, a shadow) on a
// row above the timers, 4 units apart: the buff bar's own sizes.
setOption("scale", "100");
const draw = () => plugin.widgetOverlay.draw({
    renderer: { drawRect() {}, drawTexture() {} },
    fontLoader: () => undefined,
    sprite: () => undefined,
    place: () => ({ x: 0, y: 0, scaleX: 1, scaleY: 1 }),
    canvasCssWidth: 1000,
} as unknown as WidgetOverlayDrawContext);
assert.deepEqual(draw(), [{ x: 0, y: 0, w: 46, h: 35 }, { x: 0, y: 39, w: 34, h: 34 }]);
setOption("scale", "200");
assert.deepEqual(draw(), [{ x: 0, y: 0, w: 92, h: 70 }, { x: 0, y: 78, w: 68, h: 68 }], "200%: twice the size");
plugin.setEnabledState(false);
assert.deepEqual(draw(), [], "nothing while disabled");
plugin.setEnabledState(true);

// Each corner is its own overlay position (and its own saved Alt-drag place).
const expected: Record<StatusInfoPosition, string> = {
    [StatusInfoPosition.TOP_LEFT]: OverlayPosition.TOP_LEFT,
    [StatusInfoPosition.TOP_RIGHT]: OverlayPosition.BELOW_MINIMAP,
    [StatusInfoPosition.BOTTOM_LEFT]: OverlayPosition.BOTTOM_LEFT,
    [StatusInfoPosition.BOTTOM_RIGHT]: OverlayPosition.BOTTOM_RIGHT,
};
for (const [corner, position] of Object.entries(expected)) {
    setOption("position", corner);
    assert.equal(plugin.widgetOverlay.movable.position, position, corner);
    assert.equal(plugin.widgetOverlay.movable.name, `StatusInfoOverlay_${corner}`);
}

console.log("status info tests passed");
