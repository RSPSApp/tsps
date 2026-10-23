import { CacheIndex } from "../../../rs/cache/CacheIndex";
import { CacheSystem } from "../../../rs/cache/CacheSystem";
import { IndexType } from "../../../rs/cache/IndexType";
import { BitmapFont } from "../../../rs/font/BitmapFont";
import { IndexedSprite } from "../../../rs/sprite/IndexedSprite";
import { SpriteLoader } from "../../../rs/sprite/SpriteLoader";
import { LoginScreenAnimation } from "../LoginScreenAnimation";
import type { LoginRendererHost } from "./host";

const PUBLIC_PATH = (process.env.PUBLIC_URL ?? "").replace(/\/$/, "");

function loadSprite(spriteIndex: CacheIndex, name: string) {

        try {
            const archiveId = spriteIndex.getArchiveId(name);
            if (archiveId === -1) return undefined;
            return SpriteLoader.loadIntoIndexedSprite(spriteIndex, archiveId);
        } catch {
            return undefined;
        }
    
}

function loadSprites(spriteIndex: CacheIndex, name: string) {

        try {
            const archiveId = spriteIndex.getArchiveId(name);
            if (archiveId !== -1) return SpriteLoader.loadIntoIndexedSprites(spriteIndex, archiveId);
            // Newer caches split some groups into one archive per frame: "name,0", "name,1", ...
            const frames: IndexedSprite[] = [];
            for (let frameId = spriteIndex.getArchiveId(`${name},0`); frameId !== -1; ) {
                const frame = SpriteLoader.loadIntoIndexedSprite(spriteIndex, frameId);
                if (!frame) return undefined;
                frames.push(frame);
                frameId = spriteIndex.getArchiveId(`${name},${frames.length}`);
            }
            return frames.length > 0 ? frames : undefined;
        } catch {
            return undefined;
        }
    
}

export function loadLogoImage(host: LoginRendererHost): Promise<boolean> {

        if (host.logoImage && host.logoImageLoaded) {
            return Promise.resolve(true);
        }

        return new Promise((resolve) => {
            host.logoImage = new Image();
            host.logoImage.onload = () => {
                host.logoImageLoaded = true;
                console.log("[LoginRenderer] Logo image loaded from PNG");
                resolve(true);
            };
            host.logoImage.onerror = () => {
                console.warn("[LoginRenderer] Failed to load logo image from PNG");
                host.logoImage = undefined;
                host.logoImageLoaded = false;
                resolve(false);
            };
            host.logoImage.src = `${PUBLIC_PATH}/images/logo.png`;
        });
    
}

/**
 * The title art in the cache's binary index, widest first. Each is the left half: `titlewide`
 * (545x671) is the classic `title.jpg` (383x503) with 162 more columns on the outside and more
 * floor below, the classic part at its top right.
 */
const TITLE_ART_NAMES = ["titlewide.png", "titlewide.jpg", "title.jpg"];

/**
 * The title background from the cache: the left half beside a mirrored copy that shares its
 * middle column (1089x671 for titlewide, 765x503 for title.jpg). It follows Jagex's login
 * screens (the Raids 4 art from the 2026-10-20 cache).
 */
async function loadCacheTitleBackground(cache: CacheSystem): Promise<ImageBitmap | undefined> {
    const index = cache.getIndex(IndexType.DAT2.binary);
    const name = TITLE_ART_NAMES.find((candidate) => index.getArchiveId(candidate) !== -1);
    if (!name) return undefined;
    const archiveId = index.getArchiveId(name);
    const file = index.getArchive(archiveId).getFile(0);
    if (!file) return undefined;
    const bytes = new Uint8Array(file.data.buffer, file.data.byteOffset, file.data.byteLength);
    const type = name.endsWith(".png") ? "image/png" : "image/jpeg";
    const half = await createImageBitmap(new Blob([bytes.slice()], { type }));
    const width = half.width * 2 - 1;
    const canvas = new OffscreenCanvas(width, half.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
        half.close();
        return undefined;
    }
    ctx.drawImage(half, 0, 0);
    ctx.translate(width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(half, 0, 0);
    half.close();
    return canvas.transferToImageBitmap();
}

/** The cache's title art, or the bundled image when the cache has none. */
export async function loadTitleBackground(host: LoginRendererHost, cache?: CacheSystem): Promise<boolean> {

        if (cache) {
            try {
                const image = await loadCacheTitleBackground(cache);
                if (image) {
                    host.titleBackgroundImage = image;
                    host.titleBackgroundFromCache = true;
                    console.log("[LoginRenderer] Title background loaded from the cache");
                    return true;
                }
            } catch (e) {
                console.warn("[LoginRenderer] Cache title background failed:", e);
            }
        }
        try {
            const response = await fetch(`${PUBLIC_PATH}/images/loading-bg.jpg`);
            if (response.ok) {
                const blob = await response.blob();
                const imageBitmap = await createImageBitmap(blob);
                host.titleBackgroundImage = imageBitmap;
                console.log("[LoginRenderer] Title background loaded");
                return true;
            }
        } catch (e) {
            console.warn("[LoginRenderer] Title background load failed:", e);
        }
        return false;
    
}

export function loadTitleSprites(host: LoginRendererHost, cache: CacheSystem, flamePalettes?: number[][]) {

        try {
            // Note: Logo PNG image is loaded separately via loadLogoImage()
            // This avoids async race conditions during phased loading

            const spriteIndex = cache.getIndex(IndexType.DAT2.sprites);

            host.logoSprite = loadSprite(spriteIndex, "logo");
            host.titleboxSprite = loadSprite(spriteIndex, "titlebox");
            host.titlebuttonSprite = loadSprite(spriteIndex, "titlebutton");
            host.titlebuttonLargeSprite = loadSprite(spriteIndex, "titlebutton_large");
            host.playNowTextSprite = loadSprite(spriteIndex, "play_now_text");
            host.runesSprites = loadSprites(spriteIndex, "runes");
            host.titleMuteSprites = loadSprites(spriteIndex, "title_mute");

            const radioSprites = loadSprites(spriteIndex, "options_radio_buttons");
            if (radioSprites) {
                host.optionsRadioSprite0 = radioSprites[0];
                host.optionsRadioSprite2 = radioSprites[2];
                host.optionsRadioSprite4 = radioSprites[4];
                host.optionsRadioSprite6 = radioSprites[6];
            }

            host.worldSelectLeftSprite = loadSprite(spriteIndex, "leftarrow");
            host.worldSelectRightSprite = loadSprite(spriteIndex, "rightarrow");
            host.worldSelectButtonSprite = loadSprite(spriteIndex, "sl_button");
            host.worldSelectBackSprites = loadSprites(spriteIndex, "sl_back");
            host.worldSelectFlagSprites = loadSprites(spriteIndex, "sl_flags");
            host.worldSelectStarSprites = loadSprites(spriteIndex, "sl_stars");
            host.worldSelectArrowSprites = loadSprites(spriteIndex, "sl_arrows");

            if (host.runesSprites) {
                host.loginScreenRunesAnimation = new LoginScreenAnimation(host.runesSprites, flamePalettes);
            }

            return true;
        } catch (e) {
            console.warn("[LoginRenderer] Failed to load title sprites:", e);
            return false;
        }
    
}

export function loadFonts(host: LoginRendererHost, cache: CacheSystem) {

        try {
            host.fontBold12 = BitmapFont.tryLoad(cache, 496);
            host.fontPlain11 = BitmapFont.tryLoad(cache, 494);
            host.fontPlain12 = BitmapFont.tryLoad(cache, 495);
            return !!(host.fontBold12 && host.fontPlain11 && host.fontPlain12);
        } catch (e) {
            console.warn("[LoginRenderer] Failed to load fonts:", e);
            return false;
        }
    
}
