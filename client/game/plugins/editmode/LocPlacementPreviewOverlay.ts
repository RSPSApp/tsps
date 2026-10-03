import type {
    App as PicoApp,
    DrawCall,
    Program,
    Texture,
    UniformBuffer,
    VertexArray,
} from "picogl";

import { LocModelType } from "../../../rs/config/loctype/LocModelType";
import type { LocModelLoader } from "../../../rs/config/loctype/LocModelLoader";
import type { LocTypeLoader } from "../../../rs/config/loctype/LocTypeLoader";
import type { VarManager } from "../../../rs/config/vartype/VarManager";
import type { TextureLoader } from "../../../rs/texture/TextureLoader";
import {
    getModelFacesFiltered,
    SceneBuffer,
} from "../../../render/buffer/SceneBuffer";
import { prependDefines } from "../../../render/shaders/ShaderUtil";
import type { Overlay, OverlayInitArgs, OverlayUpdateArgs } from "../../../ui/devoverlay/Overlay";
import { RenderPhase } from "../../../ui/devoverlay/Overlay";

/** Prefer a normal object, otherwise use a model shape actually present in the cache. */
export function getLocPlacementShape(type: { types?: number[] }): number {
    return type.types?.includes(LocModelType.NORMAL) ? LocModelType.NORMAL : type.types?.[0] ?? LocModelType.NORMAL;
}

export type LocPlacementPreview = {
    locId: number;
    x: number;
    y: number;
    plane: number;
    shape: number;
    rotation: number;
    /** Optional editor-only level for a straight multi-loc preview. */
    height?: number;
};

export type LocPlacementPreviewRenderer = {
    textureArray?: Texture;
    textureMaterials?: Texture;
    waterTextures?: Texture;
    sceneUniformBuffer?: UniformBuffer;
    loadedTextureIds: ReadonlySet<number>;
    getInteractLocModelLoader(): LocModelLoader | undefined;
    sampleHeightAtExactPlane(worldX: number, worldY: number, plane: number): number;
    updateTextureArray(textures: Map<number, Int32Array>): void;
};

export type LocPlacementPreviewClient = {
    textureLoader?: TextureLoader;
    locTypeLoader: LocTypeLoader;
    varManager: VarManager;
};

type Batch = {
    vertexBuffer: ReturnType<PicoApp["createInterleavedBuffer"]>;
    indexBuffer: ReturnType<PicoApp["createIndexBuffer"]>;
    array: VertexArray;
    program: Program;
    drawCall: DrawCall;
};

/** Editor-owned GPU preview. It uses the normal cache model but never touches map-square state. */
export class LocPlacementPreviewOverlay implements Overlay {
    private app?: PicoApp;
    private gl?: WebGL2RenderingContext;
    private sceneUniforms?: UniformBuffer;
    private waterMask?: Texture;
    private opaque?: Batch;
    private alpha?: Batch;
    private previewVertShader?: string;
    private mainFragShader?: string;
    private key?: string;
    private previews: readonly LocPlacementPreview[] = [];
    private client?: LocPlacementPreviewClient;
    private renderer?: LocPlacementPreviewRenderer;
    private sizeX = 1;
    private sizeY = 1;
    private readonly position = new Float32Array(3);

    init({ app, sceneUniforms }: OverlayInitArgs): void {
        this.app = app;
        this.gl = app.gl as WebGL2RenderingContext;
        this.sceneUniforms = sceneUniforms;
        this.waterMask = app.createTextureArray(new Uint8Array(16), 1, 1, 4, {
            internalFormat: this.gl.RGBA8,
            minFilter: this.gl.NEAREST,
            magFilter: this.gl.NEAREST,
            type: this.gl.UNSIGNED_BYTE,
        });
        void Promise.all([
            import("./loc-placement-preview.vert.glsl"),
            import("../../../render/shaders/main.frag.glsl"),
        ]).then(([vert, frag]) => {
            this.previewVertShader = vert.default;
            this.mainFragShader = frag.default;
            const preview = this.previews[0];
            if (!preview || !this.client || !this.renderer) return;
            this.rebuild(this.client, this.renderer);
        });
    }

    update(_args: OverlayUpdateArgs): void {}

    setPreview(
        client: LocPlacementPreviewClient,
        renderer: LocPlacementPreviewRenderer,
        preview: LocPlacementPreview,
    ): void {
        this.setPreviews(client, renderer, [preview]);
    }

    /** All entries share one cache model, so a wall run needs no map rebuild. */
    setPreviews(
        client: LocPlacementPreviewClient,
        renderer: LocPlacementPreviewRenderer,
        previews: readonly LocPlacementPreview[],
    ): void {
        const preview = previews[0];
        this.previews = previews;
        this.client = client;
        this.renderer = renderer;
        if (!preview || !this.previewVertShader || !this.mainFragShader) return;
        const key = this.previewKey(preview);
        if (this.key !== key) {
            this.destroyBatches();
            this.key = key;
        }
        if (!this.opaque && !this.alpha) this.rebuild(client, renderer);
    }

    clear(): void {
        this.previews = [];
    }

    draw(phase: RenderPhase): void {
        if (
            phase !== RenderPhase.ToSceneFramebuffer ||
            !this.app ||
            !this.gl ||
            !this.renderer ||
            this.previews.length === 0
        ) {
            return;
        }
        this.app.enable(this.gl.DEPTH_TEST);
        this.app.depthMask(false);
        this.app.disable(this.gl.CULL_FACE);
        for (const preview of this.previews) {
            this.setPosition(this.renderer, preview);
            this.opaque?.drawCall.draw();
            if (this.alpha) {
                this.app.enable(this.gl.BLEND);
                this.app.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE_MINUS_SRC_ALPHA);
                this.alpha.drawCall.draw();
                this.app.disable(this.gl.BLEND);
            }
        }
        this.app.enable(this.gl.CULL_FACE);
        this.app.depthMask(true);
    }

    dispose(): void {
        this.destroyBatches();
        this.waterMask?.delete?.();
        this.waterMask = undefined;
    }

    private rebuild(
        client: LocPlacementPreviewClient,
        renderer: LocPlacementPreviewRenderer,
    ): void {
        if (
            !this.app ||
            !this.sceneUniforms ||
            !this.waterMask ||
            !this.previewVertShader ||
            !this.mainFragShader ||
            !renderer.textureArray ||
            !renderer.textureMaterials ||
            !renderer.waterTextures
        ) {
            return;
        }
        const preview = this.previews[0];
        const textureLoader = client.textureLoader;
        const locModelLoader = renderer.getInteractLocModelLoader();
        if (!preview || !textureLoader || !locModelLoader) return;

        let locType = client.locTypeLoader.load(preview.locId);
        if (locType.transforms) {
            const transformed = locType.transform(client.varManager, client.locTypeLoader);
            if (!transformed) return;
            locType = transformed;
        }
        const diagonal = preview.shape === LocModelType.NORMAL_DIAGIONAL;
        const model = locModelLoader.getModelAnimated(
            locType,
            diagonal ? LocModelType.NORMAL : preview.shape as LocModelType,
            diagonal ? (preview.rotation + 4) & 0x7 : preview.rotation,
            -1,
            -1,
        );
        if (!model) return;

        this.sizeX = preview.rotation & 1 ? locType.sizeY : locType.sizeX;
        this.sizeY = preview.rotation & 1 ? locType.sizeX : locType.sizeY;

        const textureIds = textureLoader.getTextureIds().filter((id) => textureLoader.isSd(id)).slice(0, 2047);
        const textureIdIndexMap = new Map<number, number>();
        textureIds.forEach((id, index) => textureIdIndexMap.set(id, index));
        const faces = getModelFacesFiltered(model, textureLoader, false);
        const alphaFaces = getModelFacesFiltered(model, textureLoader, true);
        this.opaque = this.createBatch(
            model,
            faces,
            textureLoader,
            textureIdIndexMap,
            false,
            renderer,
        );
        this.alpha = this.createBatch(
            model,
            alphaFaces,
            textureLoader,
            textureIdIndexMap,
            true,
            renderer,
        );
    }

    private createBatch(
        model: Parameters<SceneBuffer["addModel"]>[0],
        faces: Parameters<SceneBuffer["addModel"]>[1],
        textureLoader: ConstructorParameters<typeof SceneBuffer>[0],
        textureIdIndexMap: Map<number, number>,
        alpha: boolean,
        renderer: LocPlacementPreviewRenderer,
    ): Batch | undefined {
        if (!this.app || !this.gl || !this.sceneUniforms || !this.waterMask ||
            !this.previewVertShader || !this.mainFragShader || faces.length === 0) return undefined;
        const scene = new SceneBuffer(textureLoader, textureIdIndexMap, model.verticesCount);
        scene.addModel(model, faces);
        const vertices = scene.vertexBuf.byteArray();
        const indices = new Int32Array(scene.indices);
        if (indices.length === 0) return undefined;

        const textures = new Map<number, Int32Array>();
        for (const id of scene.usedTextureIds) {
            if (renderer.loadedTextureIds.has(id)) continue;
            try {
                textures.set(id, textureLoader.getPixelsArgb(id, 128, true, 1));
            } catch {}
        }
        if (textures.size > 0) renderer.updateTextureArray(textures);

        const vertexBuffer = this.app.createInterleavedBuffer(12, vertices);
        const indexBuffer = this.app.createIndexBuffer(this.gl.UNSIGNED_INT, indices);
        const array = this.app
            .createVertexArray()
            .vertexAttributeBuffer(0, vertexBuffer, {
                type: this.gl.UNSIGNED_INT,
                size: 3,
                stride: 12,
                integer: true as never,
            })
            .indexBuffer(indexBuffer);
        const program = this.app.createProgram(
            alpha
                ? prependDefines(this.previewVertShader, ["DISCARD_ALPHA"])
                : this.previewVertShader,
            alpha ? prependDefines(this.mainFragShader, ["DISCARD_ALPHA"]) : this.mainFragShader,
        );
        const drawCall = this.app
            .createDrawCall(program, array)
            .uniformBlock("SceneUniforms", this.sceneUniforms)
            .uniform("u_previewPosition", this.position)
            .uniform("u_previewPlane", 0)
            .uniform("u_mapPos", [0, 0])
            .uniform("u_sceneBorderSize", 0)
            .uniform("u_worldEntityOpacity", 1)
            .texture("u_textures", renderer.textureArray!)
            .texture("u_textureMaterials", renderer.textureMaterials!)
            .texture("u_waterTextures", renderer.waterTextures!)
            .texture("u_waterMask", this.waterMask)
            .drawRanges([0, indices.length, 1]);
        return { vertexBuffer, indexBuffer, array, program, drawCall };
    }

    private setPosition(renderer: LocPlacementPreviewRenderer, preview: LocPlacementPreview): void {
        this.position[0] = preview.x + this.sizeX * 0.5;
        this.position[1] =
            preview.height ??
            renderer.sampleHeightAtExactPlane(this.position[0], preview.y + this.sizeY * 0.5, preview.plane);
        this.position[2] = preview.y + this.sizeY * 0.5;
        for (const batch of [this.opaque, this.alpha]) {
            batch?.drawCall
                .uniform("u_previewPosition", this.position)
                .uniform("u_previewPlane", preview.plane);
        }
    }

    private destroyBatches(): void {
        for (const batch of [this.opaque, this.alpha]) {
            batch?.vertexBuffer.delete?.();
            batch?.indexBuffer.delete?.();
            batch?.array.delete?.();
            batch?.drawCall.delete?.();
            batch?.program.delete?.();
        }
        this.opaque = undefined;
        this.alpha = undefined;
        this.key = undefined;
    }

    private previewKey(preview: LocPlacementPreview): string {
        return `${preview.locId}:${preview.shape}:${preview.rotation}`;
    }
}
