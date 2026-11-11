import { GameState } from "@runelite/api/GameState";
import type { GameStateChanged, PluginMessage } from "@runelite/api/events";
import { ChatboxPanelManager } from "@runelite/client/game/chatbox/ChatboxPanelManager";
import { Plugin, type PluginDescriptor } from "@runelite/client/plugins/Plugin";
import { CLIENT_TOKEN, inject } from "@runelite/client/plugins/PluginInjector";
import { PluginManager } from "@runelite/client/plugins/PluginManager";
import { CHAT_LINE_REDRAW_SCRIPT, WasdCamera, type WasdCameraClient, type WasdCameraSetting } from "../../input/WasdCamera";
import { WasdCameraPreference } from "../../input/WasdCameraPreference";
import type { OsrsClient } from "../../OsrsClient";
import type { ClientPlugin } from "../ClientPluginManager";
import { FirstPersonPlugin } from "../firstperson/FirstPersonPlugin";
import { AllSettingsToggle } from "./AllSettingsToggle";

/** The server's WasdCamera plugin offers WASD camera on this channel at login. */
export const WASD_CAMERA_CHANNEL = "wasd-camera";

/** A service that may be missing when the plugin is built on its own (tests). */
function optional<T>(get: () => T): T | undefined {
    try {
        return get();
    } catch {
        return undefined;
    }
}

/**
 * All Settings > Controls > WASD Camera: W/A/S/D turn the camera, Enter to chat (RuneLite's Key
 * Remapping, camera part). The world's server decides whether it is offered (its WasdCamera
 * plugin, on the world config page); each player then turns it on in All Settings, and the choice
 * is kept in their browser, off until they do. Always running and hidden from the plugin list.
 */
export class WasdCameraPlugin extends Plugin implements ClientPlugin, WasdCameraSetting {
    static descriptor: PluginDescriptor = {
        name: "WASD Camera",
        description: "All Settings > Controls: W, A, S and D turn the camera; press Enter to chat.",
        tags: ["wasd", "camera", "keys", "chat"],
        hidden: true,
        configKey: "wasdcameraplugin",
    };

    readonly preference: WasdCameraPreference;
    readonly camera: WasdCamera;
    readonly toggle: AllSettingsToggle;
    /** This world's server offered it since the last login. */
    private available = false;
    private readonly listeners = new Set<() => void>();
    private stopFollowing?: () => void;

    constructor(deps?: {
        client?: WasdCameraClient;
        preference?: WasdCameraPreference;
        pluginManager?: Pick<PluginManager, "getPlugin">;
        chatbox?: Pick<ChatboxPanelManager, "getCurrentInput">;
    }) {
        super();
        const client = deps?.client ?? inject<OsrsClient>(CLIENT_TOKEN);
        const plugins = deps?.pluginManager ?? optional(() => inject(PluginManager));
        const chatbox = deps?.chatbox ?? optional(() => inject(ChatboxPanelManager));
        this.preference = deps?.preference ?? new WasdCameraPreference();
        this.camera = new WasdCamera(client, this, () =>
            plugins?.getPlugin(FirstPersonPlugin)?.isActive() === true || chatbox?.getCurrentInput() !== undefined);
        this.toggle = new AllSettingsToggle(client, this.preference);
    }

    /** Offered by the server and turned on by the player. */
    isEnabled(): boolean {
        return this.available && this.preference.isEnabled();
    }

    subscribe(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    isAvailable(): boolean {
        return this.available;
    }

    protected override async startUp(): Promise<void> {
        this.stopFollowing = this.preference.subscribe(() => this.changed());
        this.camera.attach();
    }

    protected override async shutDown(): Promise<void> {
        this.camera.detach();
        this.stopFollowing?.();
        this.stopFollowing = undefined;
        this.toggle.remove();
    }

    onPluginMessage(event: PluginMessage): void {
        if (event.channel === WASD_CAMERA_CHANNEL) this.setAvailable(event.data?.available === true);
    }

    onGameStateChanged(event: GameStateChanged): void {
        const state = event.getGameState();
        if (state === GameState.LOGIN_SCREEN || state === GameState.HOPPING) this.setAvailable(false);
    }

    onScriptFinished(scriptId: number): void {
        if (this.isStarted() && scriptId === CHAT_LINE_REDRAW_SCRIPT) this.camera.chatLineRedrawn();
    }

    /** After the frame's scripts: All Settings rebuilds its list whenever it changes. */
    afterFrame(): void {
        if (this.isStarted() && this.available) this.toggle.sync();
    }

    private setAvailable(available: boolean): void {
        if (this.available === available) return;
        this.available = available;
        if (!available) this.toggle.remove();
        this.changed();
    }

    private changed(): void {
        this.toggle.refresh();
        for (const listener of [...this.listeners]) listener();
    }
}
