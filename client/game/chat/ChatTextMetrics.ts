import type { CacheSystem } from "../../rs/cache/CacheSystem";
import { IndexType } from "../../rs/cache/IndexType";
import { BitmapFont } from "../../rs/font/BitmapFont";
import { resolveTextTemplates } from "../../rs/font/textTemplates";
import { SpriteLoader } from "../../rs/sprite/SpriteLoader";

export type ChatTextMetricsDeps = {
    getCacheSystem: () => CacheSystem;
};

/**
 * Mod-icon width cache and OSRS markup text measurement for chat/widget layout.
 */
export class ChatTextMetrics {
    private modIconsWidthLoaded = false;
    private modIconWidthById: Map<number, number> = new Map();

    constructor(private readonly deps: ChatTextMetricsDeps) {}

    measureTextWidthOsrsMarkup(text: string, font: BitmapFont | undefined): number {
        text = resolveTextTemplates(text);
        if (!text) return 0;

        let width = 0;
        let chunk = "";
        const flushChunk = () => {
            if (chunk.length === 0) return;
            width += font ? font.measure(chunk) : chunk.length * 6;
            chunk = "";
        };

        for (let i = 0; i < text.length; ) {
            const ch = text.charAt(i);
            if (ch === "<") {
                const end = text.indexOf(">", i + 1);
                if (end !== -1) {
                    flushChunk();
                    const tag = text.slice(i + 1, end).toLowerCase();
                    if (tag === "lt") {
                        width += font ? font.measure("<") : 6;
                    } else if (tag === "gt") {
                        width += font ? font.measure(">") : 6;
                    } else if (tag.startsWith("img=")) {
                        const iconId = Number.parseInt(tag.slice(4), 10);
                        if (Number.isFinite(iconId) && iconId >= 0) {
                            width += this.getModIconWidth(iconId | 0);
                        }
                    }
                    i = end + 1;
                    continue;
                }
            }

            chunk += text.charCodeAt(i) === 160 ? " " : ch;
            i++;
        }

        flushChunk();
        return Math.max(0, Math.ceil(width));
    }

    private ensureModIconWidthsLoaded(): void {
        if (this.modIconsWidthLoaded) return;
        this.modIconsWidthLoaded = true;
        this.modIconWidthById.clear();
        try {
            const spriteIndex = this.deps.getCacheSystem()?.getIndex?.(IndexType.DAT2.sprites);
            if (!spriteIndex) return;
            const archiveId = (spriteIndex as any).getArchiveId?.("mod_icons");
            if (typeof archiveId !== "number" || archiveId < 0) return;
            const sprites = SpriteLoader.loadIntoIndexedSprites(spriteIndex, archiveId);
            if (!sprites || sprites.length === 0) return;
            for (let i = 0; i < sprites.length; i++) {
                const sprite = sprites[i];
                if (!sprite) continue;
                const width = Math.max(0, (sprite.width ?? sprite.subWidth ?? 0) | 0);
                this.modIconWidthById.set(i, width);
            }
        } catch {}
    }

    private getModIconWidth(iconId: number): number {
        const id = iconId | 0;
        if (id < 0) return 0;
        if (!this.modIconsWidthLoaded) {
            this.ensureModIconWidthsLoaded();
        }
        return this.modIconWidthById.get(id) ?? 0;
    }
}
