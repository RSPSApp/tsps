import { strict as assert } from "node:assert";
import { TimersConfig } from "../game/plugins/statustimer/TimersConfig";
assert.ok(TimersConfig.items.position, "Timers settings expose placement on both gameframes");
assert.ok(TimersConfig.items.scale, "Timers settings expose scale on both gameframes");
console.log("timer placement settings regression passed");

import { TimersPlugin } from "../game/plugins/statustimer/TimersPlugin";
import { TimersPosition } from "../game/plugins/statustimer/TimersConfig";
import { mobileCombatTimerStyle, combatStatusAnchor } from "../game/widgets/MobileHudLayout";
import { setAttackTimer, clearAttackTimer } from "../game/plugins/attacktimer/attackTimerState";
import { getCurrentTick } from "../network/serverConnection/timing";
const timers = new TimersPlugin();
const now = Date.now();
for (const timer of [timers.poison, timers.freeze, timers.antifire, timers.teleblock, timers.stamina]) timer.sync(300, 1, now);
timers.vengeance.syncCooldownVarbit(1, now);
setAttackTimer(4, getCurrentTick());
for (const [width, height, root, dpr, nativeWidth] of [
    [250, 400, 161, 1, 250], [375, 812, 601, 2, 523], [375, 400, 161, 2, 375],
    [1280, 720, 161, 1, 1280], [812, 375, 601, 2, 884],
]) {
    const client = { runeLite: { pluginManager: { getPlugin: () => timers } },
        widgetManager: { rootInterface: root, canvasWidth: nativeWidth, canvasHeight: height,
            minimapWidget: { width: 170, _absX: (width - 185) * dpr, _absY: 5 * dpr, _absWidth: 170 * dpr, _absHeight: 160 * dpr },
            getAllGroupRoots: (group: number) => group === 162
                ? [{ uid: 162 << 16, _absX: 0, _absY: (height - 165) * dpr, _absWidth: Math.min(519, width) * dpr, _absHeight: 165 * dpr }]
                : [{ uid: 149 << 16, _absX: Math.max(0, width - 190) * dpr, _absY: (height - 300) * dpr, _absWidth: 190 * dpr, _absHeight: 300 * dpr }],
            isEffectivelyHidden: () => false,
            getWidgetByUid: (uid: number) => (uid & 0xffff) === (root === 601 ? 116 : 78)
                ? { _absX: Math.max(0, width - 190) * dpr, _absY: (height - 300) * dpr, _absWidth: 190 * dpr, _absHeight: 300 * dpr }
                : undefined,
        },
        renderer: { canvas: { width: width * dpr, height: height * dpr, clientWidth: width, clientHeight: height } },
    } as any;
    for (const position of Object.values(TimersPosition)) for (const scale of [75, 100, 200, 999, NaN]) {
        timers.config.position = () => position;
        timers.config.scale = () => scale;
        const boxes = Array.from({ length: 7 }, (_, slot) => {
            const style = mobileCombatTimerStyle(client, slot)!;
            assert.ok(style, `${root}/${position}/${scale} slot${slot}`);
            const factor = Number(String(style.transform).match(/scale\((.+)\)/)![1]);
            return { left: Number(style.left), top: Number(style.top), width: 28 * factor, height: 28 * factor };
        });
        for (const box of boxes) {
            assert.ok(box.left >= 0 && box.top >= 0, JSON.stringify(box));
            assert.ok(box.left + box.width <= width + 0.001, JSON.stringify(box));
            assert.ok(box.top + box.height <= height + 0.001, JSON.stringify(box));
            if (position !== TimersPosition.COMBAT_ROW && height - 165 > boxes[0].top) {
                assert.ok(box.top + box.height <= height - 165, "custom timers clear the mounted chat root");
                assert.ok(box.left + box.width <= width - 190, "custom timers clear the mounted inventory root");
            }
        }
        for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
            const a = boxes[i], b = boxes[j];
            assert.ok(a.left + a.width <= b.left + 0.001 || b.left + b.width <= a.left + 0.001 || a.top + a.height <= b.top + 0.001 || b.top + b.height <= a.top + 0.001,
                `${root}/${position}/${scale}: slots${i}/${j} overlap`);
        }
        if (position !== TimersPosition.BOTTOM_LEFT && position !== TimersPosition.BOTTOM_RIGHT) {
            const anchor = combatStatusAnchor(client)!;
            assert.ok((anchor.top + anchor.rowHeight) / dpr >= Math.max(...boxes.map(b => b.top + b.height)), "Boosts corner clears complete timer grid");
        }
    }
}
assert.equal(timers.visibleInfoboxCount(), 7);
timers.poison.sync(1, 1, Date.now() - 2_000);
assert.equal(timers.visibleInfoboxCount(), 6, "expired timer does not reserve a slot before the server clears its varp");
timers.config.showAttackTimer = () => true;
assert.equal(timers.visibleInfoboxCount(), 5, "overhead attack countdown no longer reserves an infobox");
timers.setEnabledState(false);
assert.equal(timers.visibleInfoboxCount(), 0, "disabled timer plugin reserves no boxes");
clearAttackTimer();
console.log("timer placement viewport regressions passed");

import { ConfigManager } from "../runelite/client/config/ConfigManager";
import { defaultConfigStorage } from "../runelite/client/config/ConfigStorage";
const storage = defaultConfigStorage();
const config = new ConfigManager(undefined, storage);
config.registerConfig(TimersConfig);
config.setConfigValue(TimersConfig, "position", TimersPosition.BOTTOM_LEFT);
config.setConfigValue(TimersConfig, "scale", 175);
const reopened = new ConfigManager(undefined, storage).getConfig(TimersConfig);
assert.equal(reopened.position(), TimersPosition.BOTTOM_LEFT, "normal config persistence survives a fresh config owner");
assert.equal(reopened.scale(), 175);
config.setDefaultConfiguration(TimersConfig, true);
assert.equal(reopened.position(), TimersPosition.COMBAT_ROW, "native reset uses normal descriptor defaults");
assert.equal(reopened.scale(), 100);
console.log("timer config persistence/reset passed");
