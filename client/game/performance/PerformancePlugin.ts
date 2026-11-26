import { ConfigChanged } from "@runelite/api/events";
import { ConfigManager } from "@runelite/client/config/ConfigManager";
import { Plugin, type PluginDescriptor } from "@runelite/client/plugins/Plugin";
import { CLIENT_TOKEN, inject } from "@runelite/client/plugins/PluginInjector";
import type { OsrsClient } from "../OsrsClient";
import { MapManager } from "../MapManager";
import { setMapSquareCacheLimit } from "../worker/MapSquareCache";
import { setSceneChunkCacheLimits } from "../../render/loader/SceneChunkCache";
import { PerformanceConfig } from "./PerformanceConfig";
import {
    getPerformancePolicy,
    initPerformancePolicy,
    refreshPerformancePolicy,
    subscribePerformancePolicy,
    type PerformancePolicy,
} from "./PerformancePolicy";

/** Applies the tier to the renderer/client state that can change without a reload. */
function applyPolicyToClient(client: OsrsClient | undefined, policy: PerformancePolicy): void {
    MapManager.lowEnd = policy.nearbyOnlyMaps;
    setMapSquareCacheLimit(policy.mapSquareCacheLimit);
    setSceneChunkCacheLimits(policy.sceneChunkMaxSquares, policy.sceneChunkMaxBytes);
    const renderer = client?.renderer as
        | (OsrsClient["renderer"] & { applyPerformancePolicy?: (policy: PerformancePolicy) => void })
        | undefined;
    renderer?.applyPerformancePolicy?.(policy);
}

/**
 * The single saved graphics preset. Replaces the old Low-end Device plugin (its explicit
 * setting is migrated to Low in PerformancePolicy) and feeds every performance gate.
 */
export class PerformancePlugin extends Plugin {
    static descriptor: PluginDescriptor = {
        name: "Performance",
        description:
            "One graphics preset for low-end PCs: Auto, Low, Medium or High, with scene-resolution, " +
            "draw-distance and FPS overrides. Mobile memory limits still apply on High.",
        tags: ["graphics", "performance", "fps", "low detail", "mobile"],
        enabledByDefault: true,
        configKey: "performanceplugin",
    };

    static config = PerformanceConfig;

    private readonly configManager = inject(ConfigManager);
    private readonly client = inject<OsrsClient>(CLIENT_TOKEN);
    private unsubscribe?: () => void;

    override async startUp(): Promise<void> {
        initPerformancePolicy(this.configManager);
        applyPolicyToClient(this.client, getPerformancePolicy());
        this.unsubscribe = subscribePerformancePolicy((policy) => applyPolicyToClient(this.client, policy));
    }

    override async shutDown(): Promise<void> {
        this.unsubscribe?.();
        this.unsubscribe = undefined;
    }

    override setEnabledState(enabled: boolean): void {
        super.setEnabledState(enabled);
        if (enabled) {
            initPerformancePolicy(this.configManager);
            applyPolicyToClient(this.client, getPerformancePolicy());
        } else {
            refreshPerformancePolicy();
            applyPolicyToClient(this.client, getPerformancePolicy());
        }
    }

    onConfigChanged(event: ConfigChanged): void {
        if (event.getGroup() !== PerformanceConfig.group) return;
        refreshPerformancePolicy();
        applyPolicyToClient(this.client, getPerformancePolicy());
    }
}
