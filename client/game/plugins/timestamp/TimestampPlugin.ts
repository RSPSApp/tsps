import type { Client } from "@runelite/api/Client";
import type { ConfigChanged } from "@runelite/api/events";
import { CHATBOX_TRANSPARENCY } from "@runelite/api/gameval/VarbitID";
import { ConfigManager } from "@runelite/client/config/ConfigManager";
import { Plugin, type PluginDescriptor } from "@runelite/client/plugins/Plugin";
import { CLIENT_TOKEN, inject } from "@runelite/client/plugins/PluginInjector";
import { ClientImpl } from "../../../runelite/impl/ClientImpl";
import { chatHistory, type ChatHistoryStore } from "../../../rs/cs2/ChatHistory";
import { markChatTransmit } from "../../TransmitCycles";
import type { OsrsClient } from "../../OsrsClient";
import type { ScriptCallbackEvent } from "../ClientPluginManager";
import { SimpleDateFormat } from "./simpleDateFormat";
import { TimestampConfig } from "./TimestampConfig";

const DEFAULT_FORMAT = "[HH:mm]";

/** ColorUtil.wrapWithColorTag. */
export function wrapWithColorTag(text: string, color: number): string {
    return `<col=${(color & 0xffffff).toString(16).padStart(6, "0")}>${text}</col>`;
}

/**
 * RuneLite 1.13.5 Chat Timestamps: a timestamp in front of every chat line, in a format and
 * colours of your choosing. RuneLite's patched chatbox scripts (rs/cs2/runelite/chatScripts.ts)
 * ask for it with the "chatMessageBuilding" callback as they build each line.
 */
export class TimestampPlugin extends Plugin {
    static descriptor: PluginDescriptor = {
        name: "Chat Timestamps",
        description: "Add timestamps to chat messages",
        tags: ["timestamp"],
        enabledByDefault: false,
        configKey: "timestampplugin",
    };

    static config = TimestampConfig;

    readonly config = inject(ConfigManager).getConfig(TimestampConfig);
    private readonly client: Client;
    private readonly history: ChatHistoryStore;
    private formatter: SimpleDateFormat | null = null;
    /** Rebuilds the chatbox and split private chat (RuneLite runs SPLITPM_CHANGED). */
    refreshChat: () => void = markChatTransmit;

    constructor(client?: Client, history: ChatHistoryStore = chatHistory) {
        super();
        this.client = client ?? new ClientImpl(inject<OsrsClient>(CLIENT_TOKEN));
        this.history = history;
    }

    protected async startUp(): Promise<void> {
        this.updateFormatter();
        this.refreshChat();
    }

    protected async shutDown(): Promise<void> {
        this.formatter = null;
        this.refreshChat();
    }

    getFormatter(): SimpleDateFormat | null {
        return this.formatter;
    }

    onConfigChanged(event: ConfigChanged): void {
        if (event.getGroup() !== TimestampConfig.group) return;
        switch (event.getKey()) {
            case "format":
                this.updateFormatter();
                this.refreshChat();
                break;
            case "opaqueTimestamp":
            case "transparentTimestamp":
                this.refreshChat();
                break;
        }
    }

    onScriptCallback({ eventName, vm }: ScriptCallbackEvent): void {
        if (eventName !== "chatMessageBuilding" || !this.isStarted() || !this.formatter) return;
        const uid = vm.intStack[vm.intStackSize - 1];
        const messageNode = this.history.getByUid(uid);
        // RuneLite asserts the message exists; a missing one keeps the line as it is.
        if (!messageNode) return;

        let timestamp = this.generateTimestamp(Math.floor(messageNode.timestamp / 1000));
        const timestampColour = this.getTimestampColour();
        if (timestampColour !== undefined) timestamp = wrapWithColorTag(timestamp, timestampColour);
        vm.stringStack[vm.stringStackSize - 1] = timestamp;
    }

    private getTimestampColour(): number | undefined {
        const isChatboxTransparent = this.client.isResized() && this.client.getVarbitValue(CHATBOX_TRANSPARENCY) === 1;
        const colour = isChatboxTransparent ? this.config.transparentTimestamp() : this.config.opaqueTimestamp();
        return typeof colour === "number" ? colour : undefined;
    }

    /** The timestamp for a message sent at `timestamp`, in epoch seconds, in the device's zone. */
    generateTimestamp(timestamp: number): string {
        return (this.formatter ?? new SimpleDateFormat(DEFAULT_FORMAT)).format(new Date(timestamp * 1000));
    }

    private updateFormatter(): void {
        try {
            this.formatter = new SimpleDateFormat(String(this.config.timestampFormat() ?? DEFAULT_FORMAT));
        } catch {
            this.formatter = new SimpleDateFormat(DEFAULT_FORMAT);
        }
    }
}
