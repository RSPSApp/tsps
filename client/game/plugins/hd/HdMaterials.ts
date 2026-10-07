import PicoGL, { type App, type Texture } from "picogl";
import { HD_MATERIALS, HD_GROUND_MATERIALS, type HdMaterial } from "./HdMaterialData";

export const HD_TEXTURE_SIZE = 256;
export const HD_LOOKUP_WIDTH = 1024 + HD_GROUND_MATERIALS.length + 1;
const files = [...new Set([...HD_MATERIALS, ...HD_GROUND_MATERIALS].flatMap(m => [m.file, m.normal]).filter((file): file is string => !!file))];

export class HdMaterials {
    readonly lookup: Texture;
    readonly textures: Texture;
    private readonly lookupData = new Float32Array(HD_LOOKUP_WIDTH * 2 * 4);
    private readonly pixels = new Uint8Array(HD_TEXTURE_SIZE * HD_TEXTURE_SIZE * 4 * (files.length + 1));
    private readonly loaded = new Set<string>();
    private started = false;
    private disposed = false;
    private dirty = true;
    private mapping = "";

    constructor(app: App) {
        this.lookup = app.createTexture2D(HD_LOOKUP_WIDTH, 2, {
            internalFormat: PicoGL.RGBA32F, type: PicoGL.FLOAT,
            minFilter: PicoGL.NEAREST, magFilter: PicoGL.NEAREST,
        });
        this.pixels.fill(255, 0, HD_TEXTURE_SIZE * HD_TEXTURE_SIZE * 4);
        // Allocate at final dimensions: PicoGL counts array depth when allocating
        // mip levels, so width/height must exceed our small material layer count.
        this.textures = app.createTextureArray(this.pixels, HD_TEXTURE_SIZE, HD_TEXTURE_SIZE, files.length + 1, {
            minFilter: PicoGL.LINEAR_MIPMAP_LINEAR, magFilter: PicoGL.LINEAR,
            wrapS: PicoGL.REPEAT, wrapT: PicoGL.REPEAT, maxAnisotropy: 8,
        });
    }

    update(layers: Map<number, number>): void {
        if (!this.started) {
            this.started = true;
            files.forEach((file, index) => {
                const image = new Image();
                image.onload = () => {
                    if (this.disposed) return;
                    const canvas = document.createElement("canvas");
                    canvas.width = canvas.height = HD_TEXTURE_SIZE;
                    const context = canvas.getContext("2d");
                    if (!context) return;
                    try {
                        context.drawImage(image, 0, 0, HD_TEXTURE_SIZE, HD_TEXTURE_SIZE);
                        this.pixels.set(context.getImageData(0, 0, HD_TEXTURE_SIZE, HD_TEXTURE_SIZE).data, (index + 1) * HD_TEXTURE_SIZE * HD_TEXTURE_SIZE * 4);
                        this.loaded.add(file);
                        this.dirty = true;
                    } catch (error) { console.warn("117 HD: texture unavailable", error); }
                };
                image.onerror = () => { console.warn("117 HD: texture unavailable", file); };
                image.src = file;
            });
        }
        const mapping = HD_MATERIALS.map(m => layers.get(m.id) ?? 0).join(",");
        if (!this.dirty && this.mapping === mapping) return;
        this.lookupData.fill(0);
        for (let layer = 0; layer < HD_LOOKUP_WIDTH; layer++) this.lookupData[(HD_LOOKUP_WIDTH + layer) * 4 + 3] = 1;
        const readyLayer = (file: string | null) => file && this.loaded.has(file) ? files.indexOf(file) + 1 : 0;
        const write = (material: HdMaterial, layer: number) => {
            this.lookupData.set(material.params, layer * 4);
            this.lookupData.set([readyLayer(material.file), material.unlit ? 1 : 0, readyLayer(material.normal), material.brightness], (HD_LOOKUP_WIDTH + layer) * 4);
        };
        for (const material of HD_MATERIALS) {
            const layer = layers.get(material.id);
            // Layer zero is shared by untextured faces and capacity fallbacks.
            if (layer === undefined || layer <= 0 || layer >= 1024) continue;
            write(material, layer);
        }
        for (const material of HD_GROUND_MATERIALS) write(material, 1024 + material.id);
        // Publish pixels before the lookup marks them ready.
        if (this.dirty) this.textures.data(this.pixels);
        this.lookup.data(this.lookupData);
        this.mapping = mapping;
        this.dirty = false;
    }

    dispose(): void {
        this.disposed = true;
        this.lookup.delete();
        this.textures.delete();
    }
}
