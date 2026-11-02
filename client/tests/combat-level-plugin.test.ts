import assert from "node:assert/strict";
import { test } from "node:test";
import { ConfigManager } from "@runelite/client/config/ConfigManager";
import { inject } from "@runelite/client/plugins/PluginInjector";
import { StatChanged } from "@runelite/api/events";
import { Cs2Vm } from "../rs/cs2/Cs2Vm";
import { Script } from "../rs/cs2/Script";
import { Opcodes } from "../rs/cs2/Opcodes";
import { SkillId } from "../rs/skill/skills";
import { CombatLevelConfig } from "../game/plugins/combatlevel/CombatLevelConfig";
import { CombatLevelPlugin } from "../game/plugins/combatlevel/CombatLevelPlugin";
import { positionCombatTooltip } from "../game/plugins/combatlevel/CombatLevelOverlay";

test("combat panel follows real skill changes and restores text when disabled", async () => {
    const configManager = inject(ConfigManager);
    const levelWidget: any = { uid: (593 << 16) | 4, text: "Combat Lvl: 3", width: 120, height: 20, _absX: 20, _absY: 30, _absWidth: 120, _absHeight: 20 };
    const wildernessWidget: any = { uid: (90 << 16) | 49, text: "71-81" };
    const wildernessLevelWidget: any = { uid: (90 << 16) | 50, text: "Level: 5" };
    const manager: any = {
        getGroupRoot: () => ({ children: [levelWidget] }),
        getWidgetByUid: (uid: number) => uid === levelWidget.uid ? levelWidget : uid === wildernessWidget.uid ? wildernessWidget : uid === wildernessLevelWidget.uid ? wildernessLevelWidget : undefined,
        getWidgetsForGroup: () => [levelWidget],
        invalidateWidgetRender: () => {},
        isEffectivelyHidden: () => false,
    };
    const client: any = { widgetManager: manager, varManager: { getVarbit: () => 1, getVarp: () => 0 }, inputManager: { mouseX: 25, mouseY: 35 }, menuOpen: false };
    const plugin = new CombatLevelPlugin(client);
    await plugin.start();
    const levels = [SkillId.Attack, SkillId.Defence, SkillId.Strength, SkillId.Hitpoints, SkillId.Ranged, SkillId.Prayer, SkillId.Magic];
    for (const skill of levels) plugin.onStatChanged(new StatChanged(skill, 0, 60, 80));
    levelWidget.text = "Combat Lvl: 76";
    plugin.onScriptFinished(7593);
    assert.equal(levelWidget.text, "Combat Lvl: 76.5", "the Combat Options label uses real levels, not the boosted 80s");
    assert.equal(wildernessWidget.text, "71-81", "native Wilderness range remains unchanged");
    assert.equal(wildernessLevelWidget.text, "Level: 5", "Combat Level does not append a duplicate to the level row");
    levelWidget.text = "Combat Lvl: 76";
    plugin.onScriptFinished(7593);
    assert.equal(wildernessWidget.text, "71-81", "script refresh leaves native range untouched");
    assert.equal(wildernessLevelWidget.text, "Level: 5", "the level row remains owned by the native HUD");

    configManager.setConfigValue(CombatLevelConfig, "showPreciseCombatLevel", false);
    plugin.onConfigChanged({ getGroup: () => "combatlevel" } as any);
    assert.equal(levelWidget.text, "Combat Lvl: 76", "turning precision off restores the latest real combat level");
    await plugin.stop();
    assert.equal(levelWidget.text, "Combat Lvl: 76", "shutdown leaves the latest integer combat level in place");
    configManager.setConfigValue(CombatLevelConfig, "showPreciseCombatLevel", true);
});

test("disabled precision leaves native decimal text alone and restores the exact native label", async () => {
    const configManager = inject(ConfigManager);
    configManager.setConfigValue(CombatLevelConfig, "showPreciseCombatLevel", false);
    const widget: any = { uid: (593 << 16) | 4, text: "Combat Lvl: 76.82" };
    const client: any = {
        widgetManager: { getWidgetByUid: (uid: number) => uid === widget.uid ? widget : undefined, invalidateWidgetRender: () => {} },
    };
    const plugin = new CombatLevelPlugin(client);
    await plugin.start();
    const entries = [[SkillId.Attack, 1], [SkillId.Defence, 1], [SkillId.Strength, 1], [SkillId.Hitpoints, 74], [SkillId.Ranged, 1], [SkillId.Prayer, 98], [SkillId.Magic, 94]] as const;
    for (const [skill, level] of entries) plugin.onStatChanged(new StatChanged(skill, 0, level, level + 10));
    assert.equal(widget.text, "Combat Lvl: 76.82", "disabled plugin leaves cache decimal formatting untouched");

    configManager.setConfigValue(CombatLevelConfig, "showPreciseCombatLevel", true);
    plugin.onConfigChanged({ getGroup: () => "combatlevel" } as any);
    assert.equal(widget.text, "Combat Lvl: 76.825", "precise plugin display uses the exact formula");
    configManager.setConfigValue(CombatLevelConfig, "showPreciseCombatLevel", false);
    plugin.onConfigChanged({ getGroup: () => "combatlevel" } as any);
    assert.equal(widget.text, "Combat Lvl: 76.82", "disabling restores the exact cache decimal, not a recomputation");
    configManager.setConfigValue(CombatLevelConfig, "showPreciseCombatLevel", true);
    plugin.onConfigChanged({ getGroup: () => "combatlevel" } as any);
    widget.text = "Combat Lvl: 76.82";
    plugin.onScriptFinished(7593);
    assert.equal(widget.text, "Combat Lvl: 76.825", "a cache script rewrite is replaced while precise display is enabled");
    configManager.setConfigValue(CombatLevelConfig, "showPreciseCombatLevel", false);
    plugin.onConfigChanged({ getGroup: () => "combatlevel" } as any);
    assert.equal(widget.text, "Combat Lvl: 76.82", "config changes restore the cache's exact latest label");
    configManager.setConfigValue(CombatLevelConfig, "showPreciseCombatLevel", true);
    plugin.onConfigChanged({ getGroup: () => "combatlevel" } as any);
    await plugin.stop();
    assert.equal(widget.text, "Combat Lvl: 76.82", "shutdown restores the current cache-native format");
    configManager.setConfigValue(CombatLevelConfig, "showPreciseCombatLevel", false);
    configManager.setConfigValue(CombatLevelConfig, "showPreciseCombatLevel", true);
});

test("combat setup script refresh captures native text even when equal to plugin text", async () => {
    const configManager = inject(ConfigManager);
    configManager.setConfigValue(CombatLevelConfig, "showPreciseCombatLevel", true);
    const widget: any = { uid: (593 << 16) | 4, text: "Combat Lvl: 76" };
    const client: any = {
        widgetManager: { getWidgetByUid: (uid: number) => uid === widget.uid ? widget : undefined, invalidateWidgetRender: () => {} },
        varManager: { getVarbit: () => 0 },
    };
    const plugin = new CombatLevelPlugin(client);
    await plugin.start();
    const values = [[SkillId.Attack, 60], [SkillId.Defence, 60], [SkillId.Strength, 60], [SkillId.Hitpoints, 60], [SkillId.Ranged, 60], [SkillId.Prayer, 60], [SkillId.Magic, 60]] as const;
    for (const [skill, level] of values) plugin.onStatChanged(new StatChanged(skill, 0, level, level));
    plugin.onStatChanged(new StatChanged(SkillId.Defence, 0, 62, 62));
    assert.equal(widget.text, "Combat Lvl: 77", "stat update writes calculated level");
    widget.text = "Combat Lvl: 77";
    plugin.onScriptFinished(7593);
    configManager.setConfigValue(CombatLevelConfig, "showPreciseCombatLevel", false);
    plugin.onConfigChanged({ getGroup: () => "combatlevel" } as any);
    assert.equal(widget.text, "Combat Lvl: 77", "the matching native script output replaces an older snapshot");
    await plugin.stop();
    configManager.setConfigValue(CombatLevelConfig, "showPreciseCombatLevel", true);
});

test("nested combat scripts do not replace native text before setup 7593 completes", async () => {
    const configManager = inject(ConfigManager);
    configManager.setConfigValue(CombatLevelConfig, "showPreciseCombatLevel", true);
    let invalidations = 0;
    const widget: any = { uid: (593 << 16) | 4, text: "Combat Lvl: 76" };
    const scripts = new Map<number, Script>();
    const client: any = {
        widgetManager: {
            getWidgetByUid: (uid: number) => uid === widget.uid ? widget : undefined,
            invalidateWidgetRender: () => invalidations++,
            isServerOwnedWidget: () => false,
            beginBatch() {},
            endBatch() {},
        },
    };
    const vm = new Cs2Vm({ widgetManager: client.widgetManager, loadScript: (id: number) => scripts.get(id) } as any);
    client.cs2Vm = vm;
    const plugin = new CombatLevelPlugin(client);
    await plugin.start();
    const entries = [[SkillId.Attack, 60], [SkillId.Defence, 60], [SkillId.Strength, 60], [SkillId.Hitpoints, 60], [SkillId.Ranged, 60], [SkillId.Prayer, 60], [SkillId.Magic, 60]] as const;
    for (const [skill, level] of entries) plugin.onStatChanged(new StatChanged(skill, 0, level, level));
    plugin.onStatChanged(new StatChanged(SkillId.Defence, 0, 62, 62));
    assert.equal(widget.text, "Combat Lvl: 77");

    // The real VM runs the label writer, then four nested callbacks, then posts 7593.
    const root = new Script();
    root.id = 7593;
    root.instructions = Int32Array.from([Opcodes.SCONST, Opcodes.ICONST, Opcodes.IF_SETTEXT, Opcodes.INVOKE, Opcodes.INVOKE, Opcodes.INVOKE, Opcodes.INVOKE, Opcodes.RETURN]);
    root.intOperands = Int32Array.from([0, widget.uid, 0, 1972, 7603, 324, 7602, 0]);
    root.stringOperands = ["Combat Lvl: 76", null, null, null, null, null, null, null];
    scripts.set(7593, root);
    for (const id of [1972, 7603, 324, 7602]) {
        const child = new Script();
        child.id = id;
        child.instructions = Int32Array.from([Opcodes.RETURN]);
        child.intOperands = Int32Array.from([0]);
        child.stringOperands = [null];
        scripts.set(id, child);
    }
    const beforeNestedCallbacks = invalidations;
    vm.scriptPostListeners.add((id) => plugin.onScriptFinished(id));
    vm.run(root);
    assert.equal(widget.text, "Combat Lvl: 77", "7593 refreshes after its nested scripts and native write");
    assert.ok(invalidations > beforeNestedCallbacks, "only the authoritative outer setup refresh redraws Combat Options");
    configManager.setConfigValue(CombatLevelConfig, "showPreciseCombatLevel", false);
    plugin.onConfigChanged({ getGroup: () => "combatlevel" } as any);
    assert.equal(widget.text, "Combat Lvl: 76", "disable restores the outer setup's native value");
    await plugin.stop();
    configManager.setConfigValue(CombatLevelConfig, "showPreciseCombatLevel", true);
});

test("next-level tooltip follows the combat label, hides for menus and clips to the canvas", async () => {
    const widget: any = { uid: (593 << 16) | 4, text: "Combat Lvl: 3", width: 120, height: 20, _absX: 20, _absY: 30, _absWidth: 180, _absHeight: 30 };
    const client: any = {
        widgetManager: { getGroupRoot: () => ({ children: [widget] }), getWidgetByUid: (uid: number) => uid === widget.uid ? widget : undefined, getWidgetsForGroup: () => [widget], invalidateWidgetRender: () => {}, isEffectivelyHidden: () => false },
        inputManager: { mouseX: 35, mouseY: 40 },
        menuOpen: false,
    };
    const plugin = new CombatLevelPlugin(client);
    await plugin.start();
    for (const [skill, level] of [[SkillId.Attack, 1], [SkillId.Defence, 1], [SkillId.Strength, 1], [SkillId.Hitpoints, 10], [SkillId.Ranged, 1], [SkillId.Prayer, 1], [SkillId.Magic, 1]] as const) {
        plugin.onStatChanged(new StatChanged(skill, 0, level, level));
    }
    const overlay: any = plugin.widgetOverlay;
    assert.notEqual(overlay.signature(), "", "hovering combat text makes the tooltip overlay visible");
    const configManager = inject(ConfigManager);
    configManager.setConfigValue(CombatLevelConfig, "showLevelsUntil", false);
    plugin.onConfigChanged({ getGroup: () => "combatlevel" } as any);
    assert.equal(overlay.signature(), "", "the tooltip setting hides the overlay");
    configManager.setConfigValue(CombatLevelConfig, "showLevelsUntil", true);
    plugin.onConfigChanged({ getGroup: () => "combatlevel" } as any);
    assert.notEqual(overlay.signature(), "", "the tooltip returns when re-enabled");
    const calls: unknown[][] = [];
    const context: any = {
        renderer: { canvas: { width: 640, height: 480 }, drawRect: (...args: unknown[]) => calls.push(args) },
        fontLoader: () => undefined,
    };
    const rects = overlay.draw(context);
    assert.equal(rects.length, 1);
    assert.ok(rects[0].x >= 0 && rects[0].y >= 0 && rects[0].x + rects[0].w <= 640 && rects[0].y + rects[0].h <= 480);
    client.menuOpen = true;
    assert.equal(overlay.signature(), "", "an open context menu suppresses the tooltip");
    assert.deepEqual(positionCombatTooltip({ x: 620, y: 10, w: 15, h: 15 }, { x: 630, y: 15 }, { w: 640, h: 480 }, { w: 150, h: 140 }),
        { x: 464, y: 2, w: 150, h: 140 });
    await plugin.stop();
});

test("next-level tooltip hides at 126 and returns at 125, including prayer 98", async () => {
    const widget: any = { uid: (593 << 16) | 4, text: "Combat Lvl: 126", width: 120, height: 20, _absX: 20, _absY: 30, _absWidth: 120, _absHeight: 20 };
    const client: any = {
        widgetManager: { getWidgetByUid: (uid: number) => uid === widget.uid ? widget : undefined, invalidateWidgetRender: () => {}, isEffectivelyHidden: () => false },
        inputManager: { mouseX: 25, mouseY: 35 },
        menuOpen: false,
    };
    const plugin = new CombatLevelPlugin(client);
    await plugin.start();
    const update = (values: { attack: number; defence: number; strength: number; hitpoints: number; ranged: number; prayer: number; magic: number }) => {
        const ordered = [SkillId.Attack, SkillId.Defence, SkillId.Strength, SkillId.Hitpoints, SkillId.Ranged, SkillId.Prayer, SkillId.Magic] as const;
        const levels = [values.attack, values.defence, values.strength, values.hitpoints, values.ranged, values.prayer, values.magic];
        ordered.forEach((skill, i) => plugin.onStatChanged(new StatChanged(skill, 0, levels[i], levels[i])));
    };
    const max = { attack: 99, defence: 99, strength: 99, hitpoints: 99, ranged: 99, prayer: 99, magic: 99 };
    update(max);
    assert.equal(plugin.getCombatLevel(max), 126);
    assert.equal(plugin.widgetOverlay.signature(), "", "all 99s have no attainable next combat level");
    update({ ...max, prayer: 98 });
    assert.equal(plugin.getCombatLevel({ ...max, prayer: 98 }), 126, "Prayer 98 still reaches combat 126");
    assert.equal(plugin.widgetOverlay.signature(), "", "Prayer 98 does not show an impossible next-level tooltip");
    const level125 = { ...max, defence: 98 };
    update(level125);
    assert.equal(plugin.getCombatLevel(level125), 125);
    assert.notEqual(plugin.widgetOverlay.signature(), "", "a level 125 account still has a next-level tooltip");
    await plugin.stop();
});
