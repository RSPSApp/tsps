import { hintArrow, hintArrowScreenPoint, isHintArrowBlinkOn } from "../../../game/HintArrow";
import { IndexType } from "../../../rs/cache/IndexType";
import { SpriteLoader } from "../../../rs/sprite/SpriteLoader";
import type { OverlayHost } from "./OverlayHost";
import type { ScreenLayer, ScreenTexture } from "./ScreenLayer";
import { indexedSpriteToPixels } from "./textTextures";

/**
 * Port of client/ui/devoverlay/TutorialHintOverlay.ts: the flashing hint arrow
 * (`headicons_hint` frame 0) over a hinted NPC or tile.
 */
export class HintArrowLayer {
    private texture?: ScreenTexture;
    private xOffset = 0;
    private yOffset = 0;
    private loadAttempted = false;

    scale = 1.0;

    constructor(
        private readonly host: OverlayHost,
        private readonly screen: ScreenLayer,
    ) {}

    draw(): void {
        if (hintArrow.type !== 1 && hintArrow.type !== 2) return;
        if (!this.texture) this.ensureTexture();
        if (!this.texture || !isHintArrowBlinkOn()) return;
        const point = hintArrowScreenPoint(
            this.host.buildUpdateArgs(),
            this.host.osrsClient,
            (ecsId, x, z, typeId) => this.host.resolveNpcOverlayAnchor(ecsId, x, z, typeId),
        );
        if (!point) return;
        // Native draws at (x - 12, y - 28) in UI pixels; scale to buffer pixels.
        const scale = Number.isFinite(this.scale) && this.scale > 0 ? this.scale : 1;
        this.screen.queueTexture(
            this.texture,
            Math.round(point[0] + (this.xOffset - 12) * scale),
            Math.round(point[1] + (this.yOffset - 28) * scale),
            Math.max(1, Math.round(this.texture.width * scale)),
            Math.max(1, Math.round(this.texture.height * scale)),
        );
    }

    dispose(): void {
        if (this.texture) this.screen.releaseTexture(this.texture);
        this.texture = undefined;
        this.loadAttempted = false;
    }

    private ensureTexture(): void {
        if (this.loadAttempted) return;
        try {
            const cache = this.host.osrsClient.cacheSystem;
            if (!cache) return;
            this.loadAttempted = true;
            const spriteIndex = cache.getIndex(IndexType.DAT2.sprites);
            const sprite = SpriteLoader.loadIntoIndexedSprites(
                spriteIndex,
                spriteIndex.getArchiveId("headicons_hint"),
            )?.[0];
            if (!sprite) return;
            const { pixels, width, height } = indexedSpriteToPixels(sprite);
            this.texture = this.screen.createPixelTexture(pixels, width, height);
            this.xOffset = sprite.xOffset | 0;
            this.yOffset = sprite.yOffset | 0;
        } catch {}
    }
}
