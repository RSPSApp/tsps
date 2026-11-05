import { strict as assert } from "node:assert";

import { setAttackTimer, clearAttackTimer } from "../game/plugins/attacktimer/attackTimerState";
import { getCurrentTick } from "../network/serverConnection/timing";
import { TimersPlugin } from "../game/plugins/statustimer/TimersPlugin";
import { StatusTimer } from "../game/plugins/statustimer/StatusTimer";
import { mobileCombatTimerStyle, mobileHudScale } from "../game/widgets/MobileHudLayout";
import { setMobilePortraitLayoutActive } from "../game/plugins/portraitmode/PortraitLayout";

assert.equal(mobileHudScale(601, 500, 625), 1, "compact phone size");
assert.equal(mobileHudScale(601, 1000, 625), 2, "larger mobile surfaces scale with the gameframe");
assert.equal(mobileHudScale(161, 1000, 625), 1, "desktop controls keep their own scale");
const plugin = new StatusTimer();
plugin.sync(5, 319, 1_000);
assert.equal(plugin.getRemainingSeconds(1_000), 5);
plugin.sync(4, 319, 2_000);
assert.equal(plugin.getRemainingSeconds(2_000), 4, "server countdown updates must not restart the timer");
plugin.sync(-1, 2, 3_000);
assert.equal(plugin.getState().endsAt, null, "venom does not expire on its own");
plugin.sync(0, 0, 4_000);
assert.equal(plugin.getState().active, false);

const timers = new TimersPlugin();
const now = Date.now();
setAttackTimer(4, getCurrentTick());
for (const timer of [timers.poison, timers.freeze, timers.antifire, timers.teleblock, timers.stamina]) timer.sync(300, 1, now);
timers.vengeance.syncCooldownVarbit(1, now);
const runeLite = { pluginManager: { getPlugin: () => timers } };

for (const [width, height, cssW, cssH, portrait] of [
    [884, 488, 708, 390, false], [523, 1131, 375, 812, true], [523, 1000, 320, 612, true],
] as const) {
    setMobilePortraitLayoutActive(portrait);
    const client = {
        runeLite,
        widgetManager: { rootInterface: 601, canvasWidth: width, canvasHeight: height },
        renderer: { canvas: { clientWidth: cssW, clientHeight: cssH } },
    } as any;
    let previousRight = (8 + 64) * cssW / width;
    for (let slot = 0; slot < 7; slot++) {
        const style = mobileCombatTimerStyle(client, slot)!;
        assert.equal(style.width, 26, "base size stays compact; transform follows mobile gameframe growth");
        assert.equal(style.height, 26);
        assert.ok(Number(style.left) >= previousRight + (slot === 0 ? 4 : 0), "Wilderness comes first, then separate timer slots");
        previousRight = Number(style.left) + Number(style.width);
        assert.ok(previousRight <= cssW, "the row fits a narrow phone");
        assert.ok(Number(style.top) >= 165 * cssH / height, "chat and its controls remain clear in both orientations");
    }
    client.widgetManager.rootInterface = 161;
    assert.equal(mobileCombatTimerStyle(client, 0), undefined, "desktop timers keep their existing layout");
}
setMobilePortraitLayoutActive(false);

for (const [cssW, cssH, dpr, scale] of [[848, 720, 1, 1], [640, 385, 2, 1], [1440, 900, 2, 1.5]]) {
    const client = {
        runeLite,
        widgetManager: {
            rootInterface: 161, canvasWidth: cssW / scale, canvasHeight: cssH / scale,
            minimapWidget: { width: 170, _absX: (cssW - 185 * scale) * dpr, _absY: 5 * scale * dpr,
                _absWidth: 170 * scale * dpr, _absHeight: 160 * scale * dpr },
        },
        renderer: { canvas: { width: cssW * dpr, height: cssH * dpr, clientWidth: cssW, clientHeight: cssH } },
    } as any;
    let previousLeft = cssW;
    for (let slot = 0; slot < 7; slot++) {
        const style = mobileCombatTimerStyle(client, slot)!;
        assert.equal(style.top, (5 + 160 + 8) * scale, "desktop timers follow the minimap when resized or scaled");
        assert.ok(Number(style.left) + 28 <= previousLeft, "desktop timers have separate slots left of the Wilderness indicator");
        assert.ok(Number(style.left) >= 0);
        previousLeft = Number(style.left);
    }
}
const packed = { runeLite, widgetManager: { rootInterface: 601, canvasWidth: 800, canvasHeight: 400 },
    renderer: { canvas: { clientWidth: 800, clientHeight: 400 } } } as any;
const before = mobileCombatTimerStyle(packed, 1)!;
packed.renderer.canvas.clientWidth = 1600;
assert.equal(mobileCombatTimerStyle(packed, 0)!.transform, "scale(2.5)", "resize updates timer size without reloading");
packed.renderer.canvas.clientWidth = 800;
timers.poison.sync(0, 0);
assert.equal(Number(mobileCombatTimerStyle(packed, 1)!.left), Number(before.left) - 30 * 1.25, "inactive timers leave no gaps");
timers.setEnabledState(false);
assert.equal(timers.visibleInfoboxCount(), 0, "disabled timers reserve no space beside Boosts");
clearAttackTimer();
console.log("status timer plugin smoke test passed");
