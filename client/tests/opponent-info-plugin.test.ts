import { strict as assert } from "node:assert";

import { ConfigManager } from "@runelite/client/config/ConfigManager";
import { inject } from "@runelite/client/plugins/PluginInjector";
import { MenuTargetType } from "../rs/MenuEntry";
import { PLAYER_INDEX_OFFSET } from "../rs/interaction/InteractionIndex";
import type { SimpleMenuEntry } from "../ui/menu/MenuEngine";
import { OpponentInfoConfig, OpponentInfoPlugin } from "../game/plugins/opponentinfo/OpponentInfoPlugin";
import {
    OPPONENT_WAIT_MS,
    OpponentTracker,
    bossBarText,
    estimateHealth,
    healthBarLabel,
} from "../game/plugins/opponentinfo/opponentInfo";

// The server sends ratio = 1 + (scale - 1) * health / max (0 only at 0 health); the estimate
// undoes it, exactly while max <= scale.
const serverRatio = (health: number, max: number, scale: number) =>
    health > 0 ? 1 + Math.trunc(((scale - 1) * health) / max) : 0;
for (let health = 0; health <= 20; health++) {
    assert.equal(estimateHealth(serverRatio(health, 20, 30), 30, 20), health, `exact at ${health}/20`);
}
// Above the scale it's the middle of the possible range: never off by more than half a step.
for (const health of [1, 77, 250, 255]) {
    const estimate = estimateHealth(serverRatio(health, 255, 30), 30, 255);
    assert.ok(Math.abs(estimate - health) <= 255 / 29 / 2 + 1, `${estimate} near ${health}/255`);
}
assert.equal(estimateHealth(1, 1, 99), 50, "a scale of 1 only tells alive from dead");

assert.deepEqual(healthBarLabel(19, 30, 20, "hitpoints"), { value: 13, maximum: 20, text: "13/20" });
assert.equal(healthBarLabel(19, 30, 20, "both").text, "13/20 (65.0%)");
assert.equal(healthBarLabel(15, 30, 20, "percentage").text, "50.0%");
assert.equal(healthBarLabel(15, 30, undefined, "hitpoints").text, "50.0%", "no maximum (players): a percentage");

assert.equal(bossBarText("1840 / 2500", 1840, 2500, "percentage"), "73.6%");
assert.equal(bossBarText("1840 / 2500", 1840, 2500, "both"), "1840 / 2500 (73.6%)");
assert.equal(bossBarText("1840 / 2500", 1840, 2500, "hitpoints"), undefined, "the game's own text");

// The opponent stays five seconds after the player stops interacting, and a new one replaces it.
const goblin = { type: "npc" as const, serverId: 7 };
const tracker = new OpponentTracker();
assert.equal(tracker.update(undefined, 0), undefined);
assert.deepEqual(tracker.update(goblin, 100), goblin);
assert.deepEqual(tracker.update(undefined, 1_000), goblin);
assert.deepEqual(tracker.update(undefined, 1_000 + OPPONENT_WAIT_MS), goblin);
assert.equal(tracker.update(undefined, 1_001 + OPPONENT_WAIT_MS), undefined);
const man = { type: "npc" as const, serverId: 8 };
tracker.update(goblin, 10_000);
assert.deepEqual(tracker.update(man, 10_100), man);

// The plugin against a fake client: the local player (server id 1) fights NPC 7.
const NPC_TYPES: Record<number, { id: number; name: string; hitpoints: number; params: Map<number, string> }> = {
    655: { id: 655, name: "Goblin", hitpoints: 5, params: new Map() },
    2266: { id: 2266, name: "Dagannoth Prime", hitpoints: 255, params: new Map([[510, "Dagannoth Kings (Echo)"]]) },
};
const npcs = new Map<number, { type: number; interacting: number }>([
    [7, { type: 655, interacting: PLAYER_INDEX_OFFSET + 1 }],
    [8, { type: 2266, interacting: -1 }],
]);
let playerTarget = 7;
const varps = new Map<number, number>();
const hudText = { text: "1840 / 2500" };
const client: any = {
    controlledPlayerServerId: 1,
    playerEcs: {
        getIndexForServerId: (id: number) => (id === 1 ? 0 : undefined),
        getInteractionIndex: () => playerTarget,
        getName: () => "Someone",
    },
    npcEcs: {
        getEcsIdForServer: (id: number) => (npcs.has(id) ? id : undefined),
        getNpcTypeId: (id: number) => npcs.get(id)!.type,
        getInteractionIndex: (id: number) => npcs.get(id)!.interacting,
    },
    npcTypeLoader: { load: (id: number) => NPC_TYPES[id] },
    varManager: {
        getVarp: (id: number) => varps.get(id) ?? -1,
        getVarbit: (id: number) => ({ 6099: 1840, 6100: 2500 })[id] ?? 0,
    },
    widgetManager: {
        rootInterface: 161,
        getWidgetByUid: (uid: number) =>
            uid === ((161 << 16) | 91)
                ? { _absX: 0, _absY: 0, _absWidth: 800, _absHeight: 600, width: 800, height: 600 }
                : uid === ((303 << 16) | 21) ? hudText : undefined,
        isEffectivelyHidden: () => false,
        invalidateWidgetRender() {},
    },
};

async function pluginChecks(): Promise<void> {
    const plugin = new OpponentInfoPlugin(client);
    (plugin as any).barScales = new Map([[0, 30]]);
    await plugin.start();
    const signature = () => plugin.widgetOverlay.signature();

    assert.equal(signature(), "", "no bar seen yet: nothing to show (RuneLite waits for a health bar)");
    plugin.onHealthBar({ type: "npc", serverId: 7, bar: { id: 0, health: 30, health2: serverRatio(3, 5, 30) } });
    assert.match(signature(), /,Goblin,3\/5,3$/, "name and hitpoints from the cache");
    plugin.onHealthBar({ type: "npc", serverId: 7, bar: { id: 0, health: 0, health2: 0, removed: true } });
    assert.match(signature(), /,Goblin,3\/5,/, "a hidden bar keeps the last values");

    const config = inject(ConfigManager);
    config.setConfigValue(OpponentInfoConfig, "hitpointsDisplayStyle", "percentage");
    assert.match(signature(), /,Goblin,60\.0%,/);
    config.setConfigValue(OpponentInfoConfig, "hitpointsDisplayStyle", "hitpoints");

    // A boss: the cache's long name, and the panel steps aside while the boss health bar shows it.
    playerTarget = 8;
    plugin.onHealthBar({ type: "npc", serverId: 8, bar: { id: 0, health: 30, health2: 30 } });
    assert.match(signature(), /,Dagannoth Kings \(Echo\),255\/255,/);
    varps.set(1683, 2266);
    assert.equal(signature(), "", "hpbar_hud shows this npc");
    varps.delete(1683);

    // Menu: Attack on the NPC attacking the player, and on the last opponent, gets a star.
    const attack = (server: number, name: string): SimpleMenuEntry => ({
        option: "Attack",
        target: `<col=ffff00>${name}`,
        targetType: MenuTargetType.NPC,
        npcServerId: server,
    });
    const menu = [attack(7, "Goblin"), attack(8, "Dagannoth Prime"), attack(9, "Man")];
    npcs.set(9, { type: 655, interacting: -1 });
    assert.equal(plugin.transformMenuEntries(menu), menu, "off by default");
    config.setConfigValue(OpponentInfoConfig, "showOpponentsInMenu", true);
    assert.deepEqual(
        plugin.transformMenuEntries(menu).map((entry) => entry.target),
        ["*<col=ffff00>Goblin", "*<col=ffff00>Dagannoth Prime", "<col=ffff00>Man"],
    );

    // The boss health bar's text follows the display style after its update script.
    config.setConfigValue(OpponentInfoConfig, "hitpointsDisplayStyle", "both");
    plugin.onScriptFinished(2103);
    assert.equal(hudText.text, "1840 / 2500 (73.6%)");

}

pluginChecks().then(
    () => console.log("opponent info plugin test passed"),
    (err) => {
        console.error(err);
        process.exit(1);
    },
);
