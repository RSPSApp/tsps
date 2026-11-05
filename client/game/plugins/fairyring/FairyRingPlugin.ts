import { Plugin, type PluginDescriptor } from "@runelite/client/plugins/Plugin";
import { CLIENT_TOKEN, inject } from "@runelite/client/plugins/PluginInjector";
import type { OsrsClient } from "../../OsrsClient";
import type { ClientPlugin } from "../ClientPluginManager";
import { fairyRingDestination } from "./fairyRings";

/** fairyrings:confirm, "Teleport to this location" in the cache. */
const CONFIRM_UID = (398 << 16) | 26;
/** The dials' onVarTransmit/onTimer script: it runs after every dial varbit change. */
const DIAL_SCRIPT = 398;
const DIAL_VARBITS = [3985, 3986, 3987] as const;

/** RuneLite's Fairy Rings plugin: the Confirm button names the dials' destination. */
export class FairyRingPlugin extends Plugin implements ClientPlugin {
    static descriptor: PluginDescriptor = {
        name: "Fairy Rings",
        enabledByDefault: false,
        description: "Show the location of the fairy ring teleport",
        tags: ["teleportation"],
        configKey: "fairyringplugin",
    };

    private readonly client = inject<OsrsClient>(CLIENT_TOKEN);

    onScriptFinished(scriptId: number): void {
        if (scriptId !== DIAL_SCRIPT || !this.isStarted()) return;
        const manager = this.client.widgetManager;
        const vars = this.client.varManager;
        const button: any = manager?.getWidgetByUid(CONFIRM_UID);
        if (!button || button.hidden || button.isHidden || !vars) return;
        const [left, middle, right] = DIAL_VARBITS.map((varbit) => vars.getVarbit(varbit));
        const text = fairyRingDestination(left, middle, right);
        if (text === button.text) return;
        button.text = text;
        manager.invalidateWidgetRender(button, "fairy-rings");
    }
}
