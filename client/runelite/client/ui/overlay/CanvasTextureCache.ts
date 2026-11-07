/** The renderer calls the cache uses; `T` is the renderer's texture handle. */
export interface TextureSource<T> {
    getTexture(key: string): T | undefined;
    createTextureFromCanvas(key: string, canvas: HTMLCanvasElement): T;
    deleteTexture(key: string): boolean;
}

let nextKey = 0;

/**
 * GL textures for canvases that overlays and world map points draw, one per canvas, bounded:
 * past the limit the least recently created is deleted. A canvas is treated as immutable once
 * drawn; redraw it into a new canvas to change what shows.
 */
export class CanvasTextureCache {
    private readonly keys = new WeakMap<HTMLCanvasElement, string>();
    private readonly order: string[] = [];

    constructor(private readonly limit = 256) {}

    texture<T>(glr: TextureSource<T>, canvas: HTMLCanvasElement): T {
        const key = this.keys.get(canvas);
        if (key !== undefined && this.order.includes(key)) {
            // The renderer may have dropped it (a context loss); make it again under the same key.
            return glr.getTexture(key) ?? glr.createTextureFromCanvas(key, canvas);
        }
        const fresh = `rl-canvas:${++nextKey}`;
        this.keys.set(canvas, fresh);
        this.order.push(fresh);
        while (this.order.length > this.limit) glr.deleteTexture(this.order.shift()!);
        return glr.createTextureFromCanvas(fresh, canvas);
    }

    /** Deletes every texture this cache made. */
    clear(glr: TextureSource<unknown>): void {
        for (const key of this.order) glr.deleteTexture(key);
        this.order.length = 0;
    }
}
