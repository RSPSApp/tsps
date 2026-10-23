import type { CacheIndex } from "../../../rs/cache/CacheIndex";
import { IndexType } from "../../../rs/cache/IndexType";
import { isHintArrowBlinkOn } from "../../../game/HintArrow";
import { GraphicsDefaults } from "../../../rs/config/defaults/GraphicsDefaults";
import { IndexedSprite } from "../../../rs/sprite/IndexedSprite";
import { SpriteLoader } from "../../../rs/sprite/SpriteLoader";
import type { OverlayHost } from "./OverlayHost";
import type { ScreenLayer, ScreenTexture } from "./ScreenLayer";
import { indexedSpriteToPixels } from "./textTextures";

/**
 * Port of client/ui/devoverlay/OverheadPrayerOverlay.ts: PK skull, prayer and NPC head icons
 * in the same per-actor stacking order.
 */
export class OverheadPrayerLayer {
    private readonly host: OverlayHost;
    private readonly screen: ScreenLayer;

    private spriteIndex?: CacheIndex;
    private iconSprites = {
        pk: new Map<number, ScreenTexture>(),
        prayer: new Map<number, ScreenTexture>(),
        hint: new Map<number, ScreenTexture>(),
    };
    private failedSpriteIndices = {
        pk: new Set<number>(),
        prayer: new Set<number>(),
        hint: new Set<number>(),
    };
    private npcIconSprites = new Map<string, ScreenTexture>();
    private customIconSprites = new Map<IndexedSprite, ScreenTexture>();
    private failedNpcIconKeys = new Set<string>();
    private archiveIds = { pk: -1, prayer: -1, hint: -1 };

    scale = 1.0;

    constructor(host: OverlayHost, screen: ScreenLayer) {
        this.host = host;
        this.screen = screen;
    }

    init(): void {
        this.initAssetsFromCache();
    }

    draw(): void {
        const entries = this.host.overheadPrayerOutput;
        if (entries.length === 0) return;
        const args = this.host.buildUpdateArgs();
        const helpers = args.helpers;
        const stacks = args.state.actor2dStacks;

        for (const entry of entries) {
            if ((entry.plane | 0) !== (args.state.playerLevel ?? 0)) continue;
            const sprites = [
                this.getSprite("pk", entry.headIconPk | 0),
                this.getSprite("prayer", entry.headIconPrayer | 0),
                entry.headIconHint && isHintArrowBlinkOn() ? this.getSprite("hint", 0) : undefined,
                ...(entry.npcHeadIcons ?? []).map((icon) =>
                    this.getNpcSprite(icon.archiveId, icon.spriteId),
                ),
                ...(entry.customHeadIcons ?? []).map((icon) => this.getCustomSprite(icon)),
            ].filter((sprite): sprite is ScreenTexture => sprite !== undefined);
            if (sprites.length === 0) continue;

            const plane = entry.plane | 0;
            const height = helpers.getMinTileHeightInRadius(
                entry.worldX,
                entry.worldZ,
                plane,
                entry.footprintRadius ?? 0,
            );
            const headOffset = entry.heightOffsetTiles ?? 0.9;
            const screenPos = helpers.worldToScreen?.(
                entry.worldX,
                height - headOffset,
                entry.worldZ,
            );
            if (!screenPos || typeof screenPos[0] !== "number" || typeof screenPos[1] !== "number") {
                continue;
            }

            const scale = Number.isFinite(this.scale) && this.scale > 0 ? this.scale : 1.0;
            const groupKey = typeof entry.groupKey === "number" ? entry.groupKey | 0 : undefined;
            const stackOffset = groupKey !== undefined ? stacks?.get(groupKey) : undefined;
            let var18 = stackOffset ?? -2 * scale;
            if (stackOffset === undefined) {
                var18 += 7 * scale;
            }
            const centerX = Math.round(screenPos[0]);
            const centerY = Math.round(screenPos[1]);
            for (const sprite of sprites) {
                var18 += 25 * scale;
                this.screen.queueTexture(
                    sprite,
                    centerX - 12 * scale,
                    centerY - var18,
                    Math.max(1, Math.round(sprite.width * scale)),
                    Math.max(1, Math.round(sprite.height * scale)),
                    0,
                    0,
                    1,
                    1,
                    1,
                    1,
                    1,
                    1,
                );
            }
            if (groupKey !== undefined) stacks?.set(groupKey, var18);
        }
    }

    dispose(): void {
        for (const kind of ["pk", "prayer", "hint"] as const) {
            for (const sprite of this.iconSprites[kind].values()) this.screen.releaseTexture(sprite);
            this.iconSprites[kind].clear();
            this.failedSpriteIndices[kind].clear();
        }
        for (const sprite of this.npcIconSprites.values()) this.screen.releaseTexture(sprite);
        this.npcIconSprites.clear();
        this.failedNpcIconKeys.clear();
        for (const sprite of this.customIconSprites.values()) this.screen.releaseTexture(sprite);
        this.customIconSprites.clear();
    }

    private initAssetsFromCache(): void {
        try {
            const cacheSystem = this.host.osrsClient.cacheSystem;
            if (!cacheSystem) return;
            this.spriteIndex = cacheSystem.getIndex(IndexType.DAT2.sprites);
            const cacheInfo = this.host.osrsClient.loadedCache?.info;
            if (cacheInfo) {
                const defaults = GraphicsDefaults.load(cacheInfo, cacheSystem);
                this.archiveIds.pk = defaults.headIconsPk;
                this.archiveIds.prayer = defaults.headIconsPrayer;
                this.archiveIds.hint = defaults.headIconsHint;
            }
            if (this.spriteIndex) {
                for (const kind of ["pk", "prayer", "hint"] as const) {
                    if (this.archiveIds[kind] >= 0) continue;
                    try {
                        this.archiveIds[kind] = this.spriteIndex.getArchiveId(
                            kind === "pk" ? "headicons_pk" : kind === "prayer" ? "headicons_prayer" : "headicons_hint",
                        );
                    } catch {}
                }
            }
        } catch {}
    }

    private getSprite(kind: "pk" | "prayer" | "hint", index: number): ScreenTexture | undefined {
        if (index < 0) return undefined;
        const cached = this.iconSprites[kind].get(index);
        if (cached) return cached;
        if (!this.spriteIndex || this.archiveIds[kind] < 0) {
            this.initAssetsFromCache();
        }
        if (!this.spriteIndex || this.archiveIds[kind] < 0) return undefined;
        if (this.failedSpriteIndices[kind].has(index)) return undefined;
        try {
            const sprites = SpriteLoader.loadIntoIndexedSprites(
                this.spriteIndex,
                this.archiveIds[kind],
            );
            if (!sprites || index >= sprites.length) {
                this.failedSpriteIndices[kind].add(index);
                return undefined;
            }
            const indexed = sprites[index];
            if (!indexed) {
                this.failedSpriteIndices[kind].add(index);
                return undefined;
            }
            const sprite = this.createTextureFromIndexedSprite(indexed as IndexedSprite);
            this.iconSprites[kind].set(index, sprite);
            return sprite;
        } catch {
            this.failedSpriteIndices[kind].add(index);
            return undefined;
        }
    }

    private getNpcSprite(archiveId: number, spriteId: number): ScreenTexture | undefined {
        const key = `${archiveId}:${spriteId}`;
        const cached = this.npcIconSprites.get(key);
        if (cached) return cached;
        if (this.failedNpcIconKeys.has(key) || archiveId < 0 || spriteId < 0) return undefined;
        if (!this.spriteIndex) this.initAssetsFromCache();
        if (!this.spriteIndex) return undefined;
        try {
            const indexed = SpriteLoader.loadIntoIndexedSprites(this.spriteIndex, archiveId)?.[
                spriteId
            ];
            if (!indexed) {
                this.failedNpcIconKeys.add(key);
                return undefined;
            }
            const sprite = this.createTextureFromIndexedSprite(indexed as IndexedSprite);
            this.npcIconSprites.set(key, sprite);
            return sprite;
        } catch {
            this.failedNpcIconKeys.add(key);
            return undefined;
        }
    }

    private createTextureFromIndexedSprite(spr: IndexedSprite): ScreenTexture {
        const { pixels, width, height } = indexedSpriteToPixels(spr);
        return this.screen.createPixelTexture(pixels, width, height);
    }

    private getCustomSprite(icon: IndexedSprite): ScreenTexture {
        let sprite = this.customIconSprites.get(icon);
        if (!sprite) {
            sprite = this.createTextureFromIndexedSprite(icon);
            this.customIconSprites.set(icon, sprite);
        }
        return sprite;
    }
}
