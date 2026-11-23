import {
    HITSPLAT_LAYOUT_SLOTS,
    getHitsplatOffsetX,
    getHitsplatOffsetY,
} from "../../../game/actor/HitsplatLayout";
import type { CacheIndex } from "../../../rs/cache/CacheIndex";
import { ConfigType } from "../../../rs/cache/ConfigType";
import { IndexType } from "../../../rs/cache/IndexType";
import { HitSplatType } from "../../../rs/config/hitsplat/HitSplatType";
import { ArchiveHitSplatTypeLoader } from "../../../rs/config/hitsplat/HitSplatTypeLoader";
import { BitmapFont } from "../../../rs/font/BitmapFont";
import { IndexedSprite } from "../../../rs/sprite/IndexedSprite";
import { SpriteLoader } from "../../../rs/sprite/SpriteLoader";
import { FONT_PLAIN_11 } from "../../../ui/fonts";
import type { HitsplatEntry } from "../../../ui/devoverlay/Overlay";
import type { OverlayHost } from "./OverlayHost";
import type { ScreenLayer, ScreenTexture } from "./ScreenLayer";
import { indexedSpriteToPixels } from "./textTextures";

type BgParts = {
    left: ScreenTexture;
    mid: ScreenTexture;
    right: ScreenTexture;
};

/**
 * Port of client/ui/devoverlay/HitsplatOverlay.ts to the WebGPU screen layer. Definition
 * loading, animation timing and the left/middle/right box layout are unchanged; only texture
 * creation and draw calls move to WebGPU.
 */
export class HitsplatLayer {
    private readonly host: OverlayHost;
    private readonly screen: ScreenLayer;

    private bgParts?: BgParts;
    private spriteTextures = new Map<string, ScreenTexture>();
    private spriteIndex?: CacheIndex;
    private digits?: {
        texture: ScreenTexture;
        w: number;
        h: number;
        ascent: number;
    };
    private fontBmp?: BitmapFont;
    private textTextures = new Map<string, { texture: ScreenTexture; w: number; h: number }>();
    private defs?: Map<number, HitSplatType>;

    scale = 1.0;
    damageSpriteName = "hitmark,1";
    blockSpriteName = "hitmark,0";
    fontId: number = FONT_PLAIN_11;
    count = 1;
    defId = -1;
    damage = 99;
    type?: HitSplatType;

    private width = 96;
    private height = 40;


    constructor(host: OverlayHost, screen: ScreenLayer) {
        this.host = host;
        this.screen = screen;
    }

    init(): void {
        this.initAssetsFromCache();
    }

    getDefinition(id?: number): HitSplatType | undefined {
        return this.resolveDefinition(id);
    }

    draw(): void {
        const entries = this.host.hitsplatOutput;
        if (entries.length === 0) return;
        const helpers = this.host.buildUpdateArgs().helpers;

        for (const entry of entries) {
            const worldX = entry.worldX;
            const worldZ = entry.worldZ;
            const basePlane = entry.plane | 0;
            const h = helpers.getMinTileHeightInRadius(
                worldX,
                worldZ,
                basePlane,
                entry.footprintRadius ?? 0,
            );
            const headOffsetTiles = entry.heightOffsetTiles ?? 0.5;
            const anchorY = h - headOffsetTiles;

            // The WebGL hitsplat shader projects this world anchor and adds the pixel-space
            // stack offsets; ScreenLayer draws absolute pixels, so project once here.
            const screenPos = helpers.worldToScreen?.(worldX, anchorY, worldZ);
            if (!screenPos || typeof screenPos[0] !== "number" || typeof screenPos[1] !== "number") {
                continue;
            }
            const anchorScreenX = Math.round(screenPos[0]);
            const anchorScreenY = Math.round(screenPos[1]);

            const entryType =
                typeof entry.style === "number" ? this.resolveDefinition(entry.style) : undefined;
            const useType = entryType ?? this.type;

            const type2 = (entry.type2 ?? -1) | 0;
            const damage2 = (entry.damage2 ?? 0) | 0;
            const type2Def = type2 >= 0 ? this.resolveDefinition(type2) : undefined;

            const damageVal = (entry.damage ?? this.damage) | 0;
            let numberText = damageVal.toString();
            try {
                const pat = useType?.textPattern || "";
                if (pat && pat.indexOf("%1") !== -1) {
                    numberText = pat.replace(/%1/g, damageVal.toString());
                }
            } catch {}

            let numberText2: string | undefined;
            if (type2Def) {
                numberText2 = damage2.toString();
                try {
                    const pat2 = type2Def.textPattern || "";
                    if (pat2 && pat2.indexOf("%1") !== -1) {
                        numberText2 = pat2.replace(/%1/g, damage2.toString());
                    }
                } catch {}
            }

            const entryScale =
                typeof entry.scale === "number" && Number.isFinite(entry.scale) && entry.scale > 0
                    ? entry.scale
                    : 1.0;
            const overlayScale =
                typeof this.scale === "number" && Number.isFinite(this.scale) && this.scale > 0
                    ? this.scale
                    : 1.0;
            const resolvedScale = entryScale * overlayScale;
            if (!Number.isFinite(resolvedScale) || resolvedScale <= 0) continue;

            const count = Math.max(1, Math.min(4, (entry.count ?? this.count ?? 1) | 0));
            const baseTop = -12 * resolvedScale;
            const variantRaw = entry.variant ?? 0;
            // The entry's slot, which picks its HitsplatLayout offset.
            const variant =
                ((variantRaw % HITSPLAT_LAYOUT_SLOTS) + HITSPLAT_LAYOUT_SLOTS) % HITSPLAT_LAYOUT_SLOTS;

            const col = (entry.color ?? useType?.textColor ?? 0xffffff) >>> 0;
            const textOffsetY = (useType?.textOffsetY ?? 0) | 0;

            const animProgress = entry.animProgress ?? 0;
            const defXOffset = (useType?.xOffset ?? 0) | 0;
            const defYOffset = (useType?.yOffset ?? 0) | 0;
            const fadeStartCycle = (useType?.fadeStartCycle ?? -1) | 0;
            const displayCycles = (useType?.displayCycles ?? 70) | 0;

            const animXOffset = (defXOffset * animProgress) | 0;
            const animYOffset = (-defYOffset * (1 - animProgress)) | 0;

            let animAlpha = 1.0;
            if (fadeStartCycle >= 0 && displayCycles > fadeStartCycle) {
                const remainingCycles = displayCycles * (1 - animProgress);
                const fadeRange = displayCycles - fadeStartCycle;
                const alpha256 = (remainingCycles * 256) / fadeRange;
                animAlpha = Math.max(0, Math.min(1, alpha256 / 255));
            }
            const textInfo = this.digits ? this.buildTextTexture(numberText, col) : undefined;
            const primaryBgParts = useType
                ? this.getDefinitionBackgroundParts(useType)
                : this.bgParts;
            const primarySprite = useType
                ? (this.getDefinitionSingleSprite(useType) ?? this.getSpriteTextureForEntry(entry))
                : this.getSpriteTextureForEntry(entry);
            const primaryBaseWidth = primaryBgParts
                ? primaryBgParts.left.width + primaryBgParts.mid.width + primaryBgParts.right.width
                : primarySprite
                  ? primarySprite.width
                  : this.width;

            for (let i = 0; i < count; i++) {
                const pIdx = (variant + i) % HITSPLAT_LAYOUT_SLOTS;
                const cx =
                    anchorScreenX + (((getHitsplatOffsetX(pIdx) * resolvedScale) | 0) + animXOffset);
                const topY =
                    anchorScreenY +
                    (((getHitsplatOffsetY(pIdx) * resolvedScale) | 0) + baseTop + animYOffset);

                if (primaryBgParts) {
                    const lw = (primaryBgParts.left.width * resolvedScale) | 0;
                    const lh = (primaryBgParts.left.height * resolvedScale) | 0;
                    const rw = (primaryBgParts.right.width * resolvedScale) | 0;
                    const middleWidth =
                        ((primaryBaseWidth - primaryBgParts.left.width - primaryBgParts.right.width) *
                            resolvedScale) |
                        0;
                    const totalWidth = lw + middleWidth + rw;
                    const lx = cx - (totalWidth >> 1);
                    const ly = topY;
                    this.screen.queueTexture(
                        primaryBgParts.left,
                        lx,
                        ly,
                        lw,
                        lh,
                        0,
                        0,
                        1,
                        1,
                        1,
                        1,
                        1,
                        animAlpha,
                    );

                    const mw =
                        ((primaryBaseWidth - primaryBgParts.left.width - primaryBgParts.right.width) *
                            resolvedScale) |
                        0;
                    const mh = (primaryBgParts.mid.height * resolvedScale) | 0;
                    const mx0 = lx + lw;
                    for (let px = 0; px < mw; px += primaryBgParts.mid.width * resolvedScale) {
                        const x = mx0 + px;
                        const w = Math.min(primaryBgParts.mid.width * resolvedScale, mw - px) | 0;
                        this.screen.queueTexture(
                            primaryBgParts.mid,
                            x,
                            ly,
                            w,
                            mh,
                            0,
                            0,
                            w / (primaryBgParts.mid.width * resolvedScale),
                            1,
                            1,
                            1,
                            1,
                            animAlpha,
                        );
                    }

                    const rh = (primaryBgParts.right.height * resolvedScale) | 0;
                    const rx = lx + lw + mw;
                    this.screen.queueTexture(
                        primaryBgParts.right,
                        rx,
                        ly,
                        rw,
                        rh,
                        0,
                        0,
                        1,
                        1,
                        1,
                        1,
                        1,
                        animAlpha,
                    );
                } else {
                    const sprite = primarySprite;
                    if (!sprite) continue;
                    const w = (sprite.width * resolvedScale) | 0;
                    const hq = (sprite.height * resolvedScale) | 0;
                    const x = cx - (w >> 1);
                    const y = topY;
                    this.screen.queueTexture(sprite, x, y, w, hq, 0, 0, 1, 1, 1, 1, 1, animAlpha);
                }

                if (this.digits && textInfo) {
                    const tw = textInfo.w * resolvedScale;
                    const th = textInfo.h * resolvedScale;
                    const gx = cx - (tw >> 1);
                    const gy = topY + (15 + textOffsetY - textInfo.ascent) * resolvedScale;
                    this.screen.queueTexture(
                        textInfo.texture,
                        gx,
                        gy,
                        tw,
                        th,
                        0,
                        0,
                        1,
                        1,
                        1,
                        1,
                        1,
                        animAlpha,
                    );
                }

                if (type2Def && numberText2 !== undefined) {
                    const primaryWidth = primaryBgParts
                        ? ((primaryBgParts.left.width +
                              (primaryBaseWidth -
                                  primaryBgParts.left.width -
                                  primaryBgParts.right.width) +
                              primaryBgParts.right.width) *
                              resolvedScale) |
                          0
                        : primarySprite
                          ? (primarySprite.width * resolvedScale) | 0
                          : this.width * resolvedScale;
                    const secondaryXOffset = ((primaryWidth >> 1) + 2) | 0;
                    const scx = cx + secondaryXOffset;

                    const sec2LeftSprite =
                        type2Def.leftSpriteId >= 0
                            ? this.textureFromSpriteId(type2Def.leftSpriteId)
                            : undefined;
                    const sec2MidSprite =
                        type2Def.middleSpriteId >= 0
                            ? this.textureFromSpriteId(type2Def.middleSpriteId)
                            : undefined;
                    const sec2RightSprite =
                        type2Def.rightSpriteId >= 0
                            ? this.textureFromSpriteId(type2Def.rightSpriteId)
                            : undefined;

                    if (sec2LeftSprite && sec2MidSprite && sec2RightSprite) {
                        const slw = (sec2LeftSprite.width * resolvedScale) | 0;
                        const slh = (sec2LeftSprite.height * resolvedScale) | 0;
                        const srw = (sec2RightSprite.width * resolvedScale) | 0;
                        const sec2TextInfo = this.digits
                            ? this.buildTextTexture(numberText2, type2Def.textColor ?? 0xffffff)
                            : undefined;
                        const sec2TextWidth = sec2TextInfo
                            ? (sec2TextInfo.w * resolvedScale) | 0
                            : 20;
                        const sec2MiddleWidth =
                            (Math.max(sec2MidSprite.width, sec2TextWidth - slw - srw + 8) *
                                resolvedScale) |
                            0;
                        const sec2TotalWidth = slw + sec2MiddleWidth + srw;
                        const slx = scx;
                        const sly = topY;

                        this.screen.queueTexture(
                            sec2LeftSprite,
                            slx,
                            sly,
                            slw,
                            slh,
                            0,
                            0,
                            1,
                            1,
                            1,
                            1,
                            1,
                            animAlpha,
                        );

                        const smh = (sec2MidSprite.height * resolvedScale) | 0;
                        const smx0 = slx + slw;
                        const midStep = sec2MidSprite.width * resolvedScale;
                        for (let px = 0; px < sec2MiddleWidth; px += midStep) {
                            const sx = smx0 + px;
                            const sw = Math.min(midStep, sec2MiddleWidth - px) | 0;
                            this.screen.queueTexture(
                                sec2MidSprite,
                                sx,
                                sly,
                                sw,
                                smh,
                                0,
                                0,
                                sw / midStep,
                                1,
                                1,
                                1,
                                1,
                                animAlpha,
                            );
                        }

                        const srh = (sec2RightSprite.height * resolvedScale) | 0;
                        const srx = slx + slw + sec2MiddleWidth;
                        this.screen.queueTexture(
                            sec2RightSprite,
                            srx,
                            sly,
                            srw,
                            srh,
                            0,
                            0,
                            1,
                            1,
                            1,
                            1,
                            1,
                            animAlpha,
                        );

                        if (sec2TextInfo) {
                            const stw = sec2TextInfo.w * resolvedScale;
                            const sth = sec2TextInfo.h * resolvedScale;
                            const sec2TextOffsetY = (type2Def.textOffsetY ?? 0) | 0;
                            const stx = slx + (sec2TotalWidth >> 1) - (stw >> 1);
                            const sty =
                                topY + (15 + sec2TextOffsetY - sec2TextInfo.ascent) * resolvedScale;
                            this.screen.queueTexture(
                                sec2TextInfo.texture,
                                stx,
                                sty,
                                stw,
                                sth,
                                0,
                                0,
                                1,
                                1,
                                1,
                                1,
                                1,
                                animAlpha,
                            );
                        }
                    }
                }
            }
        }
    }

    dispose(): void {
        for (const entry of this.spriteTextures.values()) this.screen.releaseTexture(entry);
        this.spriteTextures.clear();
        if (this.bgParts) {
            this.screen.releaseTexture(this.bgParts.left);
            this.screen.releaseTexture(this.bgParts.mid);
            this.screen.releaseTexture(this.bgParts.right);
        }
        if (this.digits) this.screen.releaseTexture(this.digits.texture);
        for (const entry of this.textTextures.values()) this.screen.releaseTexture(entry.texture);
        this.textTextures.clear();
        this.bgParts = undefined;
        this.digits = undefined;
        this.defs = undefined;
        this.type = undefined;
        this.fontBmp = undefined;
        this.spriteIndex = undefined;
    }

    private getSpriteTextureForEntry(entry: HitsplatEntry): ScreenTexture | undefined {
        const damageVal = entry.damage ?? this.damage;
        if (damageVal == null) return undefined;
        return this.ensureSpriteTexture(damageVal > 0 ? this.damageSpriteName : this.blockSpriteName);
    }

    private ensureSpriteTexture(token: string): ScreenTexture | undefined {
        const key = token.trim().toLowerCase();
        if (!key) return undefined;
        const cached = this.spriteTextures.get(key);
        if (cached) return cached;
        const spriteIndex = this.getSpriteIndex();
        if (!spriteIndex) return undefined;
        try {
            const archiveId = spriteIndex.getArchiveId(token);
            if (archiveId < 0) return undefined;
            const sprite = SpriteLoader.loadIntoIndexedSprite(spriteIndex, archiveId);
            if (!sprite) return undefined;
            const texture = this.createTextureFromIndexedSprite(sprite);
            this.spriteTextures.set(key, texture);
            return texture;
        } catch {
            return undefined;
        }
    }

    private getSpriteIndex(): CacheIndex | undefined {
        if (this.spriteIndex) return this.spriteIndex;
        try {
            this.spriteIndex = this.host.osrsClient.cacheSystem.getIndex(IndexType.DAT2.sprites);
            return this.spriteIndex;
        } catch {
            return undefined;
        }
    }

    private getDefinitionBackgroundParts(def?: HitSplatType): BgParts | undefined {
        if (!def) return undefined;
        if (def.leftSpriteId < 0 || def.middleSpriteId < 0 || def.rightSpriteId < 0) return undefined;
        const left = this.textureFromSpriteId(def.leftSpriteId);
        const mid = this.textureFromSpriteId(def.middleSpriteId);
        const right = this.textureFromSpriteId(def.rightSpriteId);
        if (!left || !mid || !right) return undefined;
        return { left, mid, right };
    }

    private getDefinitionSingleSprite(def?: HitSplatType): ScreenTexture | undefined {
        if (!def) return undefined;
        if (def.middleSpriteId >= 0) {
            const mid = this.textureFromSpriteId(def.middleSpriteId);
            if (mid) return mid;
        }
        if (def.leftSpriteId >= 0) {
            const left = this.textureFromSpriteId(def.leftSpriteId);
            if (left) return left;
        }
        if (def.rightSpriteId >= 0) {
            const right = this.textureFromSpriteId(def.rightSpriteId);
            if (right) return right;
        }
        return undefined;
    }

    private textureFromSpriteId(spriteId: number): ScreenTexture | undefined {
        if (spriteId < 0) return undefined;
        const key = `id:${spriteId}`;
        const cached = this.spriteTextures.get(key);
        if (cached) return cached;
        const spriteIndex = this.getSpriteIndex();
        if (!spriteIndex) return undefined;
        try {
            const sprite = SpriteLoader.loadIntoIndexedSprite(spriteIndex, spriteId);
            if (!sprite) return undefined;
            const texture = this.createTextureFromIndexedSprite(sprite);
            this.spriteTextures.set(key, texture);
            return texture;
        } catch {
            return undefined;
        }
    }

    private createTextureFromIndexedSprite(spr: IndexedSprite): ScreenTexture {
        const { pixels, width, height } = indexedSpriteToPixels(spr);
        return this.screen.createPixelTexture(pixels, width, height);
    }

    private initAssetsFromCache(): void {
        const cacheSystem = this.host.osrsClient.cacheSystem;
        if (!cacheSystem) return;
        let spriteIndex: CacheIndex;
        try {
            spriteIndex = cacheSystem.getIndex(IndexType.DAT2.sprites);
        } catch {
            return;
        }
        this.spriteIndex = spriteIndex;

        const cacheInfo = this.host.osrsClient.loadedCache?.info;
        if (!cacheInfo) return;

        let usedDef: HitSplatType | undefined;
        try {
            const configIndex = cacheSystem.getIndex(IndexType.DAT2.configs);
            if (configIndex.archiveExists(ConfigType.OSRS.hitSplat)) {
                const hitsplatArchive = configIndex.getArchive(ConfigType.OSRS.hitSplat);
                if (hitsplatArchive) {
                    const loader = new ArchiveHitSplatTypeLoader(cacheInfo, hitsplatArchive);
                    if (!this.defs) {
                        const ids = Array.from(hitsplatArchive.fileIds) as number[];
                        ids.sort((a, b) => a - b);
                        const map = new Map<number, HitSplatType>();
                        for (const id of ids) {
                            try {
                                const t = loader.load(id);
                                if (t) map.set(id, t);
                            } catch {}
                        }
                        this.defs = map;
                        try {
                            if (
                                this.defId < 0 &&
                                this.host.osrsClient.loadedCache?.info?.game === "oldschool" &&
                                map.has(26)
                            ) {
                                this.defId = 26;
                            }
                        } catch {}
                    }
                    if (this.defId >= 0) {
                        const id = this.defId | 0;
                        let t = this.defs?.get(id);
                        if (t?.multihitsplats && t.multihitsplats.length >= 2) {
                            const idx = t.varbitId !== -1 ? this.getVarValue(t.varbitId, -1) : -1;
                            const arr = t.multihitsplats;
                            let nextId: number;
                            if (idx >= 0 && idx < arr.length - 1) nextId = arr[idx] | 0;
                            else nextId = arr[arr.length - 1] | 0;
                            if (nextId >= 0) {
                                try {
                                    t = this.defs?.get(nextId) ?? loader.load(nextId);
                                } catch {}
                            }
                        }
                        usedDef = t;
                        if (usedDef) this.type = usedDef;
                    }
                }
            }
        } catch {}

        if (usedDef) {
            this.type = usedDef;
            if (
                usedDef.leftSpriteId >= 0 &&
                usedDef.middleSpriteId >= 0 &&
                usedDef.rightSpriteId >= 0
            ) {
                try {
                    const left = SpriteLoader.loadIntoIndexedSprite(spriteIndex, usedDef.leftSpriteId)!;
                    const mid = SpriteLoader.loadIntoIndexedSprite(spriteIndex, usedDef.middleSpriteId)!;
                    const right = SpriteLoader.loadIntoIndexedSprite(spriteIndex, usedDef.rightSpriteId)!;
                    this.bgParts = {
                        left: this.createTextureFromIndexedSprite(left),
                        mid: this.createTextureFromIndexedSprite(mid),
                        right: this.createTextureFromIndexedSprite(right),
                    };
                    this.width =
                        (left.subWidth | 0) + (mid.subWidth | 0) + (right.subWidth | 0);
                    this.height = Math.max(
                        left.subHeight | 0,
                        mid.subHeight | 0,
                        right.subHeight | 0,
                    );
                } catch {}
            }
        }

        if (!this.bgParts) {
            const fallbackSprite =
                this.ensureSpriteTexture(this.damageSpriteName) ??
                this.ensureSpriteTexture(this.blockSpriteName);
            if (fallbackSprite) {
                this.width = fallbackSprite.width | 0;
                this.height = fallbackSprite.height | 0;
            }
            this.type = usedDef;
        }

        try {
            const fid = (this.type?.fontId ?? -1) >= 0 ? this.type!.fontId | 0 : this.fontId | 0;
            const bmp = BitmapFont.tryLoad(cacheSystem, fid);
            this.fontBmp = bmp ?? undefined;
            this.digits = bmp ? this.createDigitsAtlas(bmp) : undefined;
        } catch {}
    }

    private getVarValue(varbitId: number, varpId: number): number {
        try {
            const varManager = this.host.osrsClient.varManager as unknown as {
                getVarbit?: (id: number) => number;
                getVarp?: (id: number) => number;
            };
            if (varbitId !== -1 && varManager.getVarbit) return varManager.getVarbit(varbitId) | 0;
            if (varpId !== -1 && varManager.getVarp) return varManager.getVarp(varpId) | 0;
        } catch {}
        return -1;
    }

    private createDigitsAtlas(bmp: BitmapFont): {
        texture: ScreenTexture;
        w: number;
        h: number;
        ascent: number;
    } {
        const digits = "0123456789";
        let totalW = 2;
        let maxH = 1;
        for (let i = 0; i < digits.length; i++) {
            const ch = digits.charCodeAt(i) & 0xff;
            const w = (bmp.widths[ch] | 0) || 1;
            const h = (bmp.heights[ch] | 0) || 1;
            totalW += w + 1;
            maxH = Math.max(maxH, h);
        }
        const W = totalW | 0;
        const H = Math.max(1, maxH | 0);
        const out = new Uint8Array(W * H * 4);
        let penX = 1;
        for (let i = 0; i < digits.length; i++) {
            const ch = digits.charCodeAt(i) & 0xff;
            const w = (bmp.widths[ch] | 0) || 1;
            const h = (bmp.heights[ch] | 0) || 1;
            const img = bmp.glyphPixels[ch] as Uint8Array | undefined;
            for (let y = 0; y < h; y++) {
                for (let x = 0; x < w; x++) {
                    const idx = (img ? img[y * w + x] : 0) & 0xff;
                    if (idx === 0) continue;
                    const di = (penX + x + y * W) * 4;
                    out[di] = 255;
                    out[di + 1] = 255;
                    out[di + 2] = 255;
                    out[di + 3] = 255;
                }
            }
            penX += w + 1;
        }
        const texture = this.screen.createPixelTexture(out, W, H);
        return { texture, w: W, h: H, ascent: bmp.maxAscent | 0 || H };
    }

    private buildTextTexture(
        text: string,
        color: number,
    ): { texture: ScreenTexture; w: number; h: number; ascent: number } | undefined {
        const bmp = this.fontBmp;
        if (!bmp) return undefined;
        const activeFontId = (this.type?.fontId ?? -1) >= 0 ? this.type!.fontId | 0 : this.fontId | 0;
        const key = `${activeFontId}|${bmp.ascent}|${color >>> 0}|${text}`;
        const cached = this.textTextures.get(key);
        if (cached) return { ...cached, ascent: bmp.maxAscent | 0 };
        try {
            const w = Math.max(1, bmp.measure(text) | 0);
            const h = Math.max(1, (bmp.maxAscent + bmp.maxDescent) | 0 || bmp.ascent | 0 || 12);
            const canvas = document.createElement("canvas");
            canvas.width = w;
            canvas.height = h;
            const ctx2 = canvas.getContext("2d", {
                willReadFrequently: true as never,
            }) as CanvasRenderingContext2D | null;
            if (!ctx2) return undefined;
            const baseline = bmp.maxAscent | 0;
            const cssColor = `#${(color >>> 0).toString(16).padStart(6, "0")}`;
            bmp.draw(ctx2, text, 0, baseline, cssColor);
            const texture = this.screen.getCanvasTexture(canvas);
            if (!texture) return undefined;
            if (this.textTextures.size >= 256) {
                const oldestKey = this.textTextures.keys().next().value;
                if (oldestKey !== undefined) {
                    const oldest = this.textTextures.get(oldestKey);
                    if (oldest) this.screen.releaseTexture(oldest.texture);
                    this.textTextures.delete(oldestKey);
                }
            }
            this.textTextures.set(key, { texture, w, h });
            return { texture, w, h, ascent: bmp.maxAscent | 0 };
        } catch {
            return undefined;
        }
    }

    private resolveDefinition(id?: number): HitSplatType | undefined {
        const defs = this.defs;
        if (!defs || defs.size === 0) return undefined;
        if (typeof id !== "number" || id < 0) return undefined;
        let t = defs.get(id);
        if (!t) return undefined;
        if (t.multihitsplats && t.multihitsplats.length >= 2) {
            const idx = t.varbitId !== -1 ? this.getVarValue(t.varbitId, -1) : -1;
            const arr = t.multihitsplats;
            let nextId: number;
            if (idx >= 0 && idx < arr.length - 1) nextId = arr[idx] | 0;
            else nextId = arr[arr.length - 1] | 0;
            if (nextId >= 0) {
                t = defs.get(nextId) ?? t;
            }
        }
        return t;
    }
}
