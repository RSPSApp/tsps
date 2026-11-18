import { strict as assert } from "node:assert";
import { TouchControlsPlugin, type TouchControlsClient } from "../game/plugins/touchcontrols/TouchControlsPlugin";
import { PadMode, TouchControlsConfig } from "../game/plugins/touchcontrols/TouchControlsConfig";
import { GameState } from "../game/login/GameState";
import { PluginInjector } from "../runelite/client/plugins/PluginInjector";
import { ConfigManager } from "../runelite/client/config/ConfigManager";
import { ConfigChanged } from "../runelite/api/events/ConfigChanged";

const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
try {
    for (const scenario of [
        { name: "touchscreen laptop", touch: 10, coarse: false, hover: true, visible: false },
        { name: "phone", touch: 5, coarse: true, hover: false, visible: true },
        { name: "tablet", touch: 10, coarse: true, hover: false, visible: true },
        { name: "desktop", touch: 0, coarse: false, hover: true, visible: false },
        { name: "touch-capable fine pointer without hover", touch: 5, coarse: false, hover: false, visible: false },
        { name: "coarse pointer with hover", touch: 5, coarse: true, hover: true, visible: false },
        { name: "legacy touch event only", touch: 0, coarse: false, hover: true, visible: false },
    ]) {
        for (const search of ["", "?touch=1", "?touch=0"]) {
            Object.defineProperty(globalThis, "navigator", { configurable: true, value: { maxTouchPoints: scenario.touch } });
            Object.defineProperty(globalThis, "window", { configurable: true, value: {
                location: { search }, ontouchstart: null,
                matchMedia: (query: string) => ({ matches: query === "(pointer: coarse)" ? scenario.coarse : query === "(hover: none)" ? !scenario.hover : false }),
                addEventListener() {}, removeEventListener() {},
            } });
            const manager = new ConfigManager(undefined);
            const injector = new PluginInjector(manager).provide(ConfigManager, manager);
            const client = {
                gameState: GameState.LOGGED_IN, isLoggedIn: () => true,
                widgetManager: { interfaceParents: new Map(), isEffectivelyHidden: () => false },
            } as unknown as TouchControlsClient;
            const plugin = injector.runWith(() => new TouchControlsPlugin(client));
            plugin.onClientTick();
            assert.equal(plugin.getUiState().visible, search === "?touch=1" || (search !== "?touch=0" && scenario.visible), `${scenario.name}/${search}: Default`);
            for (const mode of [PadMode.ON, PadMode.OFF, PadMode.DEFAULT]) {
                manager.setConfigValue(TouchControlsConfig, "padMode", mode);
                plugin.onConfigChanged(new ConfigChanged(TouchControlsConfig.group, "padMode", undefined, mode));
                const expected = mode === PadMode.ON || (mode === PadMode.DEFAULT && (search === "?touch=1" || (search !== "?touch=0" && scenario.visible)));
                assert.equal(plugin.getUiState().visible, expected, `${scenario.name}/${search}/${mode}`);
            }
            plugin.setEnabledState(false);
            plugin.onClientTick();
            assert.equal(plugin.getUiState().visible, false, "plugin disable still hides controls");
            manager.destroy();
        }
    }
} finally {
    if (navigatorDescriptor) Object.defineProperty(globalThis, "navigator", navigatorDescriptor);
    else delete (globalThis as any).navigator;
    if (windowDescriptor) Object.defineProperty(globalThis, "window", windowDescriptor);
    else delete (globalThis as any).window;
}
console.log("Touch controls default: 21 device/query scenarios, live On/Off/Default and plugin disable passed");
