import { strict as assert } from "node:assert";
import type { Client } from "@runelite/api/Client";
import { ConfigChanged } from "@runelite/api/events";
import { CHATBOX_TRANSPARENCY } from "@runelite/api/gameval/VarbitID";
import { ConfigManager } from "@runelite/client/config/ConfigManager";
import { inject } from "@runelite/client/plugins/PluginInjector";
import { SimpleDateFormat } from "../game/plugins/timestamp/simpleDateFormat";
import { TimestampConfig } from "../game/plugins/timestamp/TimestampConfig";
import { TimestampPlugin, wrapWithColorTag } from "../game/plugins/timestamp/TimestampPlugin";
import { ChatHistoryStore } from "../rs/cs2/ChatHistory";

// --- Config: RuneLite's group, keys and defaults -------------------------------------------------
assert.equal(TimestampConfig.group, "timestamp");
assert.equal(TimestampConfig.items.timestampFormat.keyName, "format");
assert.equal(TimestampConfig.items.timestampFormat.default, "[HH:mm]");
assert.equal(TimestampConfig.items.opaqueTimestamp.default, undefined, "no colour until one is picked");
assert.equal(TimestampPlugin.descriptor.name, "Chat Timestamps");
assert.equal(TimestampPlugin.descriptor.enabledByDefault, false, "off by default, as RuneLite");

// --- SimpleDateFormat: the pattern letters RuneLite's description lists -------------------------
const date = new Date(2026, 10, 3, 14, 5, 9, 7); // 3 Nov 2026 14:05:09.007, local time
assert.equal(new SimpleDateFormat("[HH:mm]").format(date), "[14:05]");
assert.equal(new SimpleDateFormat("yyyy-MM-dd HH:mm:ss").format(date), "2026-11-03 14:05:09");
assert.equal(new SimpleDateFormat("hh:mm a").format(date), "02:05 PM");
assert.equal(new SimpleDateFormat("h:mm a").format(new Date(2026, 0, 1, 0, 30)), "12:30 AM", "midnight is 12 AM");
assert.equal(new SimpleDateFormat("'at' HH 'o''clock'").format(date), "at 14 o'clock", "quoted text and ''");
assert.equal(new SimpleDateFormat("EEE d MMM yy").format(date), "Tue 3 Nov 26");
assert.equal(new SimpleDateFormat("ss.SSS").format(date), "09.007");
assert.throws(() => new SimpleDateFormat("HH:mm q"), /Illegal pattern character 'q'/, "as SimpleDateFormat");
assert.throws(() => new SimpleDateFormat("'unterminated"), /Unterminated quote/);
assert.equal(wrapWithColorTag("[14:05]", 0xff00ff), "<col=ff00ff>[14:05]</col>");

// --- The plugin -----------------------------------------------------------------------------------
let resized = true;
let transparency = 0;
const client = {
    isResized: () => resized,
    getVarbitValue: (id: number) => (id === CHATBOX_TRANSPARENCY ? transparency : 0),
} as unknown as Client;
const history = new ChatHistoryStore();
const plugin = new TimestampPlugin(client, history);
let refreshes = 0;
plugin.refreshChat = () => refreshes++;
const config = inject(ConfigManager);
const changed = (key: string) => plugin.onConfigChanged(new ConfigChanged("timestamp", key, undefined, undefined));

const uid = history.addMessage(0, "Welcome to the game.");
const message = history.getByUid(uid)!;
message.timestamp = date.getTime();

/** RuneLite's chatMessageBuilding callback: ints [splitpmbox, uid], objects [..., timestamp]. */
function build(timestamp = ""): string {
    const vm: any = { intStack: [0, uid], intStackSize: 2, stringStack: ["game", "", "Welcome", timestamp], stringStackSize: 4 };
    plugin.onScriptCallback({ eventName: "chatMessageBuilding", vm });
    return vm.stringStack[3];
}

assert.equal(build(), "", "a stopped plugin leaves the line");
void plugin.start();
assert.equal(refreshes, 1, "startUp rebuilds the chatbox");
assert.equal(build(), "[14:05]", "the message's arrival time, as [HH:mm]");
assert.equal(build("[14:05:09]"), "[14:05]", "replaces the game's own timestamp setting's");

config.setConfigValue(TimestampConfig, "opaqueTimestamp", 0xff0000);
changed("opaqueTimestamp");
assert.equal(build(), "<col=ff0000>[14:05]</col>", "opaque chatbox colour");
assert.equal(refreshes, 2, "a colour change rebuilds the chatbox");
transparency = 1;
assert.equal(build(), "[14:05]", "transparent chatbox: its own colour, unset");
config.setConfigValue(TimestampConfig, "transparentTimestamp", 0x00ff00);
assert.equal(build(), "<col=00ff00>[14:05]</col>");
resized = false;
assert.equal(build(), "<col=ff0000>[14:05]</col>", "fixed mode is never transparent");

config.setConfigValue(TimestampConfig, "timestampFormat", "HH:mm:ss");
changed("format");
assert.equal(build(), "<col=ff0000>14:05:09</col>");
config.setConfigValue(TimestampConfig, "timestampFormat", "HH:mm qq");
changed("format");
assert.equal(plugin.generateTimestamp(date.getTime() / 1000), "[14:05]", "an invalid format falls back to [HH:mm]");

// Another callback, or a message the history no longer has, is left alone.
const other: any = { intStack: [0, uid], intStackSize: 2, stringStack: ["x"], stringStackSize: 1 };
plugin.onScriptCallback({ eventName: "chatFilterCheck", vm: other });
assert.equal(other.stringStack[0], "x");
const gone: any = { intStack: [0, 9999], intStackSize: 2, stringStack: [""], stringStackSize: 1 };
plugin.onScriptCallback({ eventName: "chatMessageBuilding", vm: gone });
assert.equal(gone.stringStack[0], "");

void plugin.stop();
assert.equal(build(), "", "a stopped plugin leaves the line");
assert.equal(refreshes, 5, "format changes and shutDown rebuild the chatbox");

console.log("Chat Timestamps plugin tests passed");
