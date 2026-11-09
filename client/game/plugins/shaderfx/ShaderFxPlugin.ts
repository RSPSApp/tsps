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
import type { GroundItemMutation } from "../../data/ground/GroundItemStore";
import { ShaderFxConfig } from "./ShaderFxConfig";
import { PRAYER_AURA_COLORS, type PlayerScreen, type ShaderFxRuntime, type ShaderFxSettings, ShaderFxState } from "./ShaderFxState";

/** The varp that holds poison and venom: positive while poisoned (over a million for venom), negative while an antipoison protects. */
const POISON_VARP = 102;
/**
 * The varbit holding the equipped weapon's category (the combat tab's weapon type): 3 bow,
 * 5 crossbow, 6 salamander, 7 chinchompa, 8 gun, 19 thrown.
 */
const WEAPON_TYPE_VARBIT = 357;
const RANGED_WEAPON_TYPES: ReadonlySet<number> = new Set([3, 5, 6, 7, 8, 19]);
/**
 * A ranged shot and a spell both send a projectile and a graphic on the player a few
 * milliseconds apart, in either order. With a ranged weapon the graphic is the draw-back, so it
 * is not a spell; anything else is a cast.
 */
const PROJECTILE_GRAPHIC_WINDOW_MS = 300;

/** Ice spell graphics (Rush, Burst, Blitz, Barrage) that play on a frozen target. */
const ICE_GRAPHICS: ReadonlySet<number> = new Set([361, 363, 367, 369]);
/** Bind, Snare and Entangle graphics that play on a rooted target. */
const ENTANGLE_GRAPHICS: ReadonlySet<number> = new Set([181, 180, 179]);
/**
 * The graphics a teleport plays on the caster (standard 111, ancient 392, lunar 747, arceuus 1296,
 * tablet 678, scroll 1039). Animations are not used: the ancient teleport shares 1979 with the
 * ancient combat spells.
 */
const TELEPORT_GRAPHICS: ReadonlySet<number> = new Set([111, 392, 747, 1296, 678, 1039]);
/** A move this far in one game tick is a teleport: running covers two tiles. */
const TELEPORT_TILES = 6;
/** Ground item ownership values for a drop that is yours (TileItem.OWNERSHIP_SELF, OWNERSHIP_GROUP). */
const OWNERSHIP_SELF = 1;
const OWNERSHIP_GROUP = 3;
/** A ground item store snapshot removes a stack and puts it back at once: that is not a drop. */
const SNAPSHOT_REPLAY_MS = 100;

/** Reused for every frame's answer, so the haze's lookup makes no object of its own. */
const PLAYER_SCREEN: PlayerScreen = { u: 0.5, v: 0.5, radius: 0.1 };

/** Where the local player is on screen: the middle of their body, and half their height. */
function playerScreenOf(osrs: OsrsClient): PlayerScreen | undefined {
    const geometry = osrs.sceneGeometry;
    const canvas = (osrs.renderer as { canvas?: { width: number; height: number } } | undefined)?.canvas;
    const index = osrs.playerEcs.getIndexForServerId(osrs.controlledPlayerServerId | 0);
    if (!geometry || !canvas || !(canvas.width > 0) || !(canvas.height > 0) || index === undefined) return undefined;
    const x = osrs.playerEcs.getX(index) / 128;
    const y = osrs.playerEcs.getY(index) / 128;
    const ground = geometry.tileHeight(x, y, osrs.playerEcs.getLevel(index) | 0);
    // Heights are negative upwards; a player stands about a tile and a bit tall.
    const feet = geometry.worldToScreen(x, ground, y);
    const head = geometry.worldToScreen(x, ground - 1.35, y);
    if (!feet || !head) return undefined;
    PLAYER_SCREEN.u = (feet[0] + head[0]) / 2 / canvas.width;
    PLAYER_SCREEN.v = (feet[1] + head[1]) / 2 / canvas.height;
    PLAYER_SCREEN.radius = Math.abs(feet[1] - head[1]) / 2 / canvas.height;
    return PLAYER_SCREEN;
}

/** What the plugin reads from the game; tests replace it. */
export interface ShaderFxDeps {
    client: Client;
    /** The local player's server index, or -1 before login. */
    localPlayerId(): number;
    /** Milliseconds on a monotonic clock. */
    now(): number;
    /** Where the local player is on screen right now, if the scene can say. */
    playerScreen?(): PlayerScreen | undefined;
    /** Calls `listener` for each ground item change; returns how to stop. Absent: no loot flash. */
    subscribeGroundItems?(listener: (event: GroundItemMutation) => void): () => void;
}

/**
 * Shader Effects: optional screen shaders for combat, magic and ranged. The plugin only watches
 * the game (hits, graphics, projectiles, stats) and keeps a few decaying impulses; each renderer
 * (117 HD, core WebGPU, WebGL) asks for them every frame through `shaderFx()` and draws the shader.
 */
export class ShaderFxPlugin extends Plugin {
    static descriptor: PluginDescriptor = {
        name: "Shader Effects",
        description: "Optional screen shaders for hits, magic, ranged and more. Works on every renderer.",
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
    private lastProjectileAt = -1e9;
    private lastSpec = -1;
    private levelTotal = -1;
    private lastX = -1;
    private lastY = -1;
    /** When each ground stack last despawned, to tell a snapshot's re-add from a real drop. */
    private readonly despawnedAt = new Map<number, number>();

    private readonly runtime: ShaderFxRuntime = {
        fill: (out) => {
            // The haze follows the player, so its screen spot is read every frame it shows.
            if (this.settings.prayerAura && this.state.hasPrayerAura()) this.state.setPlayerScreen(this.deps.playerScreen?.());
            return this.state.fill(out, this.settings, this.deps.now());
        },
        wantsPlayerMask: () => this.settings.prayerAura && this.state.hasPrayerAura(),
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
                playerScreen: () => playerScreenOf(osrs),
                subscribeGroundItems: (listener) => {
                    const store = osrs.groundItems;
                    store?.mutationListeners.add(listener);
                    return () => store?.mutationListeners.delete(listener);
                },
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
        const stopLoot = this.deps.subscribeGroundItems?.((event) => this.onGroundItem(event));
        if (stopLoot) this.unsubscribers.push(stopLoot);
    }

    protected override async shutDown(): Promise<void> {
        for (const unsubscribe of this.unsubscribers) unsubscribe();
        this.unsubscribers = [];
        this.despawnedAt.clear();
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
        // Positive while poisoned; negative is the antipoison's immunity timer, not poison.
        this.state.setPoisoned(client.getVarpValue(POISON_VARP) > 0);

        const spec = client.getVarpValue(SA_ENERGY);
        if (this.lastSpec >= 0 && spec < this.lastSpec) this.state.specUsed(now);
        this.lastSpec = spec;

        let total = 0;
        for (let skill = 0; skill <= SkillId.Sailing; skill++) total += client.getRealSkillLevel(skill as SkillId);
        if (this.levelTotal >= 0 && total > this.levelTotal) this.state.levelUp(now);
        this.levelTotal = total;

        this.state.setPrayerAura(this.prayerAura());
        this.watchTeleport(now);
    }

    /** The colour of the active prayers with an aura, blended; undefined when none is on. */
    private prayerAura(): [number, number, number] | undefined {
        let r = 0;
        let g = 0;
        let b = 0;
        let count = 0;
        for (const [varbit, cr, cg, cb] of PRAYER_AURA_COLORS) {
            if (this.deps.client.getVarbitValue(varbit) <= 0) continue;
            r += cr;
            g += cg;
            b += cb;
            count++;
        }
        return count > 0 ? [r / count, g / count, b / count] : undefined;
    }

    /** A teleport has no event of its own, so a long jump between two ticks is one. */
    private watchTeleport(now: number): void {
        const point = this.deps.client.getLocalPlayer()?.getWorldLocation();
        if (!point) return;
        const x = point.getX();
        const y = point.getY();
        if (this.lastX >= 0 && Math.max(Math.abs(x - this.lastX), Math.abs(y - this.lastY)) >= TELEPORT_TILES) {
            this.state.teleported(now);
        }
        this.lastX = x;
        this.lastY = y;
    }

    /** From the ground item store: a new stack of yours worth the threshold starts the loot flash. */
    private onGroundItem(event: GroundItemMutation): void {
        if (!this.isEnabled()) return;
        const { stack } = event;
        const now = this.deps.now();
        if (event.kind === "despawn") {
            this.despawnedAt.set(stack.id, now);
            if (this.despawnedAt.size > 256) {
                for (const [id, at] of this.despawnedAt) if (now - at > SNAPSHOT_REPLAY_MS) this.despawnedAt.delete(id);
            }
            return;
        }
        if (event.kind !== "spawn") return;
        const replayed = now - (this.despawnedAt.get(stack.id) ?? -1e9) < SNAPSHOT_REPLAY_MS;
        if (replayed) return;
        if (stack.ownership !== OWNERSHIP_SELF && stack.ownership !== OWNERSHIP_GROUP) return;
        this.state.lootDropped(stack.gePrice * Math.max(1, stack.quantity), this.settings.lootFlashValue, now);
    }

    private onGraphic(event: ActorGraphicUpdate): void {
        if (!this.isEnabled() || event.graphic < 0) return;
        const local = this.deps.localPlayerId();
        if (event.type !== "player" || local < 0 || event.serverId !== local) return;
        const now = this.deps.now();
        // The target-side graphics of freezing and rooting spells are statuses, not casts.
        if (ICE_GRAPHICS.has(event.graphic)) return this.state.frozen(now);
        if (ENTANGLE_GRAPHICS.has(event.graphic)) return this.state.entangled(now);
        if (TELEPORT_GRAPHICS.has(event.graphic)) return this.state.teleportStarted(now);
        // A ranged weapon's draw-back plays right with its projectile: not a spell.
        if (this.rangedWeapon() && now - this.lastProjectileAt < PROJECTILE_GRAPHIC_WINDOW_MS) return;
        this.state.cast(event.graphic, now, this.settings);
    }

    private onProjectile(launch: ProjectileLaunch): void {
        if (!this.isEnabled()) return;
        const actor = launch.source.actor;
        const local = this.deps.localPlayerId();
        if (!actor || actor.kind !== "player" || local < 0 || actor.serverId !== local) return;
        const now = this.deps.now();
        this.lastProjectileAt = now;
        // Only a ranged weapon's shot is ranged focus; a spell's projectile is a cast.
        if (!this.rangedWeapon()) return;
        this.state.cancelCast();
        this.state.rangedFired(now);
    }

    private rangedWeapon(): boolean {
        return RANGED_WEAPON_TYPES.has(this.deps.client.getVarbitValue(WEAPON_TYPE_VARBIT));
    }

    private resetBaselines(): void {
        this.lastSpec = -1;
        this.levelTotal = -1;
        this.lastX = this.lastY = -1;
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
            inkOutlines: c.inkOutlines(),
            prayerAura: c.prayerAura(),
            freezeEffect: c.freezeEffect(),
            thornsEffect: c.thornsEffect(),
            teleportWarp: c.teleportWarp(),
            lootFlash: c.lootFlash(),
            lootFlashValue: Math.max(1, Number(c.lootFlashValue()) | 0),
        };
    }
}
