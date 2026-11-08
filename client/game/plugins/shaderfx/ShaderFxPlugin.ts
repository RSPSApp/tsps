import type { Client } from "@runelite/api/Client";
import { GameState } from "@runelite/api/GameState";
import type { GameStateChanged } from "@runelite/api/events";
import { SA_ENERGY } from "@runelite/api/gameval/VarPlayerID";
import { ConfigManager } from "@runelite/client/config/ConfigManager";
import { Plugin, type PluginDescriptor } from "@runelite/client/plugins/Plugin";
import { CLIENT_TOKEN, inject } from "@runelite/client/plugins/PluginInjector";
import type { ProjectileLaunch } from "../../../common/projectiles/ProjectileLaunch";
import { subscribeProjectiles } from "../../../network/ServerConnection";
import { SkillId } from "../../../rs/skill/skills";
import { type ActorGraphicUpdate, subscribeActorGraphics, subscribeActorHitsplats } from "../../ActorEventHooks";
import type { HitsplatEventPayload } from "../../GameRenderer";
import type { OsrsClient } from "../../OsrsClient";
import { ClientImpl } from "../../../runelite/impl/ClientImpl";
import { ShaderFxConfig } from "./ShaderFxConfig";
import { type ShaderFxRuntime, type ShaderFxSettings, ShaderFxState } from "./ShaderFxState";

/** The varp that holds poison and venom: positive while poisoned, over a million when venom. */
const POISON_VARP = 102;
/** A projectile this soon after a graphic on the player is a spell, not a ranged shot. */
const SPELL_PROJECTILE_WINDOW_MS = 700;

/** What the plugin reads from the game; tests replace it. */
export interface ShaderFxDeps {
    client: Client;
    /** The local player's server index, or -1 before login. */
    localPlayerId(): number;
    /** Milliseconds on a monotonic clock. */
    now(): number;
}

/**
 * Shader Effects: optional screen shaders for combat, magic and ranged. The plugin only watches
 * the game (hits, graphics, projectiles, stats) and keeps a few decaying impulses; 117 HD's
 * WebGPU post chain asks for them each frame through `shaderFx()` and draws the shader.
 */
export class ShaderFxPlugin extends Plugin {
    static descriptor: PluginDescriptor = {
        name: "Shader Effects",
        description: "Optional screen shaders for hits, magic, ranged and more. Needs 117 HD on WebGPU.",
        tags: ["shader", "effects", "combat", "magic", "ranged", "bloom", "vignette", "post", "graphics", "hd"],
        enabledByDefault: false,
        configKey: "shaderfxplugin",
    };

    static config = ShaderFxConfig;

    private readonly config = inject(ConfigManager).getConfig(ShaderFxConfig);
    private readonly deps: ShaderFxDeps;
    private readonly state = new ShaderFxState();
    private settings: ShaderFxSettings;
    private unsubscribers: Array<() => void> = [];
    private lastCastAt = -1e9;
    private lastSpec = -1;
    private levelTotal = -1;

    private readonly runtime: ShaderFxRuntime = {
        fill: (out) => this.state.fill(out, this.settings, this.deps.now()),
    };

    constructor(deps?: ShaderFxDeps) {
        super();
        if (deps) {
            this.deps = deps;
        } else {
            const osrs = inject<OsrsClient>(CLIENT_TOKEN);
            this.deps = {
                client: new ClientImpl(osrs),
                localPlayerId: () => osrs.controlledPlayerServerId | 0,
                now: () => performance.now(),
            };
        }
        this.settings = this.readConfig();
    }

    protected override async startUp(): Promise<void> {
        this.settings = this.readConfig();
        this.state.reset();
        this.resetBaselines();
        this.unsubscribers = [
            subscribeActorGraphics((event) => this.onGraphic(event)),
            subscribeActorHitsplats((event) => this.handleHitsplat(event)),
            subscribeProjectiles((launch) => this.onProjectile(launch)),
        ];
    }

    protected override async shutDown(): Promise<void> {
        for (const unsubscribe of this.unsubscribers) unsubscribe();
        this.unsubscribers = [];
        this.state.reset();
    }

    /** The post chain's handle, only while the plugin is on. */
    shaderFx(): ShaderFxRuntime | undefined {
        return this.isEnabled() ? this.runtime : undefined;
    }

    onConfigChanged(): void {
        this.settings = this.readConfig();
    }

    onGameStateChanged(event: GameStateChanged): void {
        const state = event.getGameState();
        if (state === GameState.LOGGED_IN) return;
        this.state.reset();
        this.resetBaselines();
    }

    /** From the actor hitsplat feed: the engine's onHitsplat hook only sees hits on players. */
    handleHitsplat(event: HitsplatEventPayload): void {
        if (!this.isEnabled()) return;
        const now = this.deps.now();
        const local = this.deps.localPlayerId();
        const mine = event.targetType === "player" && local >= 0 && event.targetId === local;
        if (mine) this.state.hitTaken(event.damage, this.settings.bigHitDamage, now);
        // Hitsplats do not say who dealt them, so any hit on an NPC counts as one you landed.
        else if (event.targetType === "npc") this.state.hitDealt(event.damage, this.settings.dealMinDamage, now);
    }

    /** Polls what has no event: hitpoints, special energy, poison and levels. */
    onGameTick(): void {
        if (!this.isEnabled()) return;
        const client = this.deps.client;
        const now = this.deps.now();
        this.state.setHealth(client.getBoostedSkillLevel(SkillId.Hitpoints), client.getRealSkillLevel(SkillId.Hitpoints));
        this.state.setPoisoned(client.getVarpValue(POISON_VARP) !== 0 && client.getVarpValue(POISON_VARP) !== -1);

        const spec = client.getVarpValue(SA_ENERGY);
        if (this.lastSpec >= 0 && spec < this.lastSpec) this.state.specUsed(now);
        this.lastSpec = spec;

        let total = 0;
        for (let skill = 0; skill <= SkillId.Sailing; skill++) total += client.getRealSkillLevel(skill as SkillId);
        if (this.levelTotal >= 0 && total > this.levelTotal) this.state.levelUp(now);
        this.levelTotal = total;
    }

    private onGraphic(event: ActorGraphicUpdate): void {
        if (!this.isEnabled() || event.graphic < 0) return;
        const local = this.deps.localPlayerId();
        if (event.type !== "player" || local < 0 || event.serverId !== local) return;
        const now = this.deps.now();
        this.lastCastAt = now;
        this.state.cast(event.graphic, now, this.settings);
    }

    private onProjectile(launch: ProjectileLaunch): void {
        if (!this.isEnabled()) return;
        const actor = launch.source.actor;
        const local = this.deps.localPlayerId();
        if (!actor || actor.kind !== "player" || local < 0 || actor.serverId !== local) return;
        const now = this.deps.now();
        if (now - this.lastCastAt < SPELL_PROJECTILE_WINDOW_MS) return;
        this.state.rangedFired(now);
    }

    private resetBaselines(): void {
        this.lastSpec = -1;
        this.levelTotal = -1;
    }

    private readConfig(): ShaderFxSettings {
        const c = this.config;
        return {
            intensity: Math.max(0, Math.min(200, c.intensity() | 0)) / 100,
            damageVignette: c.damageVignette(),
            damageColor: c.damageColor() >>> 0,
            hitChromatic: c.hitChromatic(),
            hitShake: c.hitShake(),
            hitShockwave: c.hitShockwave(),
            hitGlitch: c.hitGlitch(),
            bigHitDamage: c.bigHitDamage(),
            lowHealth: c.lowHealth(),
            lowHealthPercent: c.lowHealthPercent(),
            dealPunch: c.dealPunch(),
            dealMinDamage: c.dealMinDamage(),
            specFlash: c.specFlash(),
            castGlow: c.castGlow(),
            castColor: c.castColor() >>> 0,
            castHueFromGraphic: c.castHueFromGraphic(),
            rangedFocus: c.rangedFocus(),
            levelUpBurst: c.levelUpBurst(),
            poisonTint: c.poisonTint(),
            colorGrade: c.colorGrade(),
            filmGrain: c.filmGrain(),
            scanlines: c.scanlines(),
            staticVignette: c.staticVignette(),
            staticChromatic: c.staticChromatic(),
            sharpen: c.sharpen(),
            tiltShift: c.tiltShift(),
            pixelate: c.pixelate(),
            posterize: c.posterize(),
        };
    }
}
