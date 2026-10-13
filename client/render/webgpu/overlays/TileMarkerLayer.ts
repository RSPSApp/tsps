import type { TileHighlightRenderEntry } from "../../../game/highlights/TileHighlightManager";
import { GPU_BUFFER_USAGE, GPU_SHADER_STAGE, SCENE_DEPTH_FORMAT } from "../bindings";
import { createScenePipeline, withSampleCount } from "../multisample";
import { WORLD_OVERLAY_WGSL } from "../shaders/overlay.wgsl";
import type { OverlayHost } from "./OverlayHost";

const FLOATS_PER_VERTEX = 7; // pos(3) + color(4)
const SHADER_STAGES = GPU_SHADER_STAGE.VERTEX | GPU_SHADER_STAGE.FRAGMENT;

type TileData = { x: number; y: number; effPlane: number };

type DrawSegment = {
    first: number;
    count: number;
    /** "fill" uses triangle-list, "line" uses line-strip. */
    kind: "fill" | "line";
    depth: boolean;
};

/**
 * Port of client/ui/devoverlay/TileMarkerOverlay.ts. Depth-aware tiles are drawn inside the
 * world pass (drawWorld), always-on-top actor tiles/highlights in the screen pass
 * (drawScreen). TRIANGLE_FAN fills are converted to triangle-list.
 */
export class TileMarkerLayer {
    private readonly host: OverlayHost;
    private readonly device: GPUDevice;
    private readonly format: GPUTextureFormat;
    private readonly sceneBindGroup: GPUBindGroup;
    private readonly sceneLayout: GPUBindGroupLayout;

    private readonly extensionFormat?: GPUTextureFormat;

    private fillDepthPipeline!: GPURenderPipeline;
    private lineDepthPipeline!: GPURenderPipeline;
    /** World-pass twins for an extension's HDR scene target; absent without `extensionFormat`. */
    private fillDepthPipelineExt?: GPURenderPipeline;
    private lineDepthPipelineExt?: GPURenderPipeline;
    private fillPipeline!: GPURenderPipeline;
    private linePipeline!: GPURenderPipeline;

    private vertexBuffer?: GPUBuffer;
    private vertexCapacity = 0;
    private data = new Float32Array(0);
    private floats = 0;
    private segments: DrawSegment[] = [];
    private worldSegments: DrawSegment[] = [];
    private screenSegments: DrawSegment[] = [];
    private hoverTile?: TileData;
    private destTile?: TileData;
    private currentTile?: TileData;
    private hoverEnabled = true;
    private actorServerTiles?: ReadonlyArray<{
        x: number;
        y: number;
        plane: number;
        kind: "player" | "npc";
        serverId: number;
        label: string;
    }>;
    private tileHighlights?: ReadonlyArray<TileHighlightRenderEntry>;

    hoverColor = [1, 1, 0, 1];
    hoverFillColor = [1, 1, 0, 0.25];
    destColor = [0, 0, 1, 1];
    destFillColor = [0, 0, 1, 0.2];
    currentColor = [0.5, 0.5, 0.5, 1];
    serverTileColor = [1, 0, 1, 1];

    constructor(
        host: OverlayHost,
        device: GPUDevice,
        format: GPUTextureFormat,
        sceneBindGroup: GPUBindGroup,
        sceneLayout: GPUBindGroupLayout,
        extensionFormat?: GPUTextureFormat,
    ) {
        this.host = host;
        this.device = device;
        this.format = format;
        this.sceneBindGroup = sceneBindGroup;
        this.sceneLayout = sceneLayout;
        this.extensionFormat = extensionFormat;
    }

    init(): void {
        const device = this.device;
        const module = device.createShaderModule({ code: WORLD_OVERLAY_WGSL, label: "overlay-world" });
        // Reuse the exact layout the scene bind group was created with; WebGPU requires
        // layout identity between a pipeline layout and a bound bind group.
        const layout = device.createPipelineLayout({
            bindGroupLayouts: [this.sceneLayout],
        });
        const vertex = {
            module,
            entryPoint: "vs_world",
            buffers: [
                {
                    arrayStride: FLOATS_PER_VERTEX * 4,
                    attributes: [
                        { shaderLocation: 0, offset: 0, format: "float32x3" as const },
                        { shaderLocation: 1, offset: 12, format: "float32x4" as const },
                    ],
                },
            ],
        };
        const blend = {
            color: {
                srcFactor: "src-alpha" as const,
                dstFactor: "one-minus-src-alpha" as const,
                operation: "add" as const,
            },
            alpha: {
                srcFactor: "src-alpha" as const,
                dstFactor: "one-minus-src-alpha" as const,
                operation: "add" as const,
            },
        };
        const fragment = (format: GPUTextureFormat) => ({
            module,
            entryPoint: "fs_world",
            targets: [{ format, blend }],
        });
        const depth = {
            format: SCENE_DEPTH_FORMAT,
            depthWriteEnabled: false,
            depthCompare: "less-equal" as const,
        };
        const depthPipeline = (format: GPUTextureFormat, kind: "fill" | "line", label: string) =>
            createScenePipeline(device, {
                label,
                layout,
                vertex,
                fragment: fragment(format),
                primitive: { topology: kind === "fill" ? "triangle-list" : "line-strip", cullMode: "none" },
                depthStencil: depth,
            });
        this.fillDepthPipeline = depthPipeline(this.format, "fill", "tile-marker-fill-depth");
        this.lineDepthPipeline = depthPipeline(this.format, "line", "tile-marker-line-depth");
        if (this.extensionFormat) {
            // The extension's world pass targets its offscreen HDR format instead of the canvas.
            this.fillDepthPipelineExt = depthPipeline(this.extensionFormat, "fill", "tile-marker-fill-depth-ext");
            this.lineDepthPipelineExt = depthPipeline(this.extensionFormat, "line", "tile-marker-line-depth-ext");
        }
        this.fillPipeline = device.createRenderPipeline({
            label: "tile-marker-fill",
            layout,
            vertex,
            fragment: fragment(this.format),
            primitive: { topology: "triangle-list", cullMode: "none" },
        });
        this.linePipeline = device.createRenderPipeline({
            label: "tile-marker-line",
            layout,
            vertex,
            fragment: fragment(this.format),
            primitive: { topology: "line-strip", cullMode: "none" },
        });
    }

    /** Builds this frame's marker geometry from the shared overlay state. */
    update(config: { destinationTileColor: number; currentTileColor: number }): void {
        const args = this.host.buildUpdateArgs();
        const state = args.state;
        this.hoverEnabled = !!state.hoverEnabled;
        this.actorServerTiles = state.actorServerTiles;
        this.tileHighlights = state.tileHighlights;

        const resolvePlane = (tile: { x: number; y: number; plane?: number }): number => {
            if (typeof tile.plane === "number" && Number.isFinite(tile.plane)) return tile.plane | 0;
            const basePlane = (state.playerRawLevel ?? state.playerLevel) | 0;
            return (
                args.helpers.getHeightSamplePlaneForTile?.(tile.x | 0, tile.y | 0, basePlane) ??
                basePlane
            );
        };
        this.hoverTile = state.hoverTile
            ? { x: state.hoverTile.x | 0, y: state.hoverTile.y | 0, effPlane: resolvePlane(state.hoverTile) }
            : undefined;
        this.destTile = state.destTile
            ? { x: state.destTile.x | 0, y: state.destTile.y | 0, effPlane: resolvePlane(state.destTile) }
            : undefined;
        this.currentTile = state.currentTile
            ? { x: state.currentTile.x | 0, y: state.currentTile.y | 0, effPlane: resolvePlane(state.currentTile) }
            : undefined;

        this.setColorFromRgb(this.destColor, config.destinationTileColor, 1.0);
        this.setColorFromRgb(this.destFillColor, config.destinationTileColor, 0.2);
        this.setColorFromRgb(this.currentColor, config.currentTileColor, 1.0);

        this.floats = 0;
        this.worldSegments = [];
        this.screenSegments = [];
        this.buildGeometry();
    }

    drawWorld(pass: GPURenderPassEncoder, useExtensionFormat: boolean = false, sampleCount: number = 1): void {
        this.drawSegments(pass, this.worldSegments, true, useExtensionFormat, sampleCount);
    }

    drawScreen(pass: GPURenderPassEncoder): void {
        this.drawSegments(pass, this.screenSegments, false);
    }

    dispose(): void {
        this.vertexBuffer?.destroy();
        this.vertexBuffer = undefined;
    }

    private buildGeometry(): void {
        const sample = (x: number, y: number, plane: number): number =>
            this.host.sampleHeightAtExactPlane(x, y, plane);

        if (this.hoverEnabled && this.hoverTile) {
            const { x, y, effPlane } = this.hoverTile;
            this.pushTile(x, y, effPlane, sample, this.hoverFillColor, this.hoverColor, this.worldSegments);
        }
        if (this.destTile) {
            const { x, y, effPlane } = this.destTile;
            this.pushTile(x, y, effPlane, sample, this.destFillColor, this.destColor, this.worldSegments);
        }
        if (this.currentTile) {
            const { x, y, effPlane } = this.currentTile;
            this.pushLine(x, y, effPlane, sample, this.currentColor, this.worldSegments);
        }

        if (this.tileHighlights && this.tileHighlights.length > 0) {
            for (const highlight of this.tileHighlights) {
                if (!highlight) continue;
                const effPlane = this.host.getEffectivePlaneForTile(
                    highlight.x,
                    highlight.y,
                    highlight.plane,
                );
                const target = highlight.alwaysOnTop ? this.screenSegments : this.worldSegments;
                if (highlight.fillAlpha > 0) {
                    const fill = this.colorFromRgb(highlight.colorRgb, highlight.fillAlpha);
                    this.pushFill(highlight.x, highlight.y, effPlane, sample, fill, target);
                }
                const line = this.colorFromRgb(highlight.colorRgb, 1.0);
                this.pushLine(highlight.x, highlight.y, effPlane, sample, line, target);
            }
        }

        if (this.hoverEnabled && this.actorServerTiles && this.actorServerTiles.length > 0) {
            for (const t of this.actorServerTiles) {
                const effPlane = this.host.getEffectivePlaneForTile(t.x | 0, t.y | 0, t.plane | 0);
                this.pushLine(t.x | 0, t.y | 0, effPlane, sample, this.serverTileColor, this.screenSegments);
            }
        }
    }

    private pushTile(
        tileX: number,
        tileY: number,
        effPlane: number,
        sample: (x: number, y: number, plane: number) => number,
        fillColor: number[],
        lineColor: number[],
        target: DrawSegment[],
    ): void {
        this.pushFill(tileX, tileY, effPlane, sample, fillColor, target);
        this.pushLine(tileX, tileY, effPlane, sample, lineColor, target);
    }

    private pushFill(
        tileX: number,
        tileY: number,
        effPlane: number,
        sample: (x: number, y: number, plane: number) => number,
        color: number[],
        target: DrawSegment[],
    ): void {
        const first = this.floats / FLOATS_PER_VERTEX;
        const c0 = sample(tileX, tileY, effPlane) - 0.015;
        const c1 = sample(tileX + 1, tileY, effPlane) - 0.015;
        const c2 = sample(tileX + 1, tileY + 1, effPlane) - 0.015;
        const c3 = sample(tileX, tileY + 1, effPlane) - 0.015;
        // Triangle-fan (0,1,2,3) becomes (0,1,2),(0,2,3).
        this.pushVertex(tileX, c0, tileY, color);
        this.pushVertex(tileX + 1, c1, tileY, color);
        this.pushVertex(tileX + 1, c2, tileY + 1, color);
        this.pushVertex(tileX, c0, tileY, color);
        this.pushVertex(tileX + 1, c2, tileY + 1, color);
        this.pushVertex(tileX, c3, tileY + 1, color);
        target.push({ first, count: 6, kind: "fill", depth: target === this.worldSegments });
    }

    private pushLine(
        tileX: number,
        tileY: number,
        effPlane: number,
        sample: (x: number, y: number, plane: number) => number,
        color: number[],
        target: DrawSegment[],
    ): void {
        const first = this.floats / FLOATS_PER_VERTEX;
        const c0 = sample(tileX, tileY, effPlane) - 0.02;
        const c1 = sample(tileX + 1, tileY, effPlane) - 0.02;
        const c2 = sample(tileX + 1, tileY + 1, effPlane) - 0.02;
        const c3 = sample(tileX, tileY + 1, effPlane) - 0.02;
        this.pushVertex(tileX, c0, tileY, color);
        this.pushVertex(tileX + 1, c1, tileY, color);
        this.pushVertex(tileX + 1, c2, tileY + 1, color);
        this.pushVertex(tileX, c3, tileY + 1, color);
        this.pushVertex(tileX, c0, tileY, color);
        target.push({ first, count: 5, kind: "line", depth: target === this.worldSegments });
    }

    private pushVertex(x: number, y: number, z: number, color: number[]): void {
        const required = this.floats + FLOATS_PER_VERTEX;
        if (this.data.length < required) {
            let next = Math.max(64, this.data.length * 2 || 64);
            while (next < required) next *= 2;
            const grown = new Float32Array(next);
            grown.set(this.data.subarray(0, this.floats));
            this.data = grown;
        }
        const i = this.floats;
        this.data[i] = x;
        this.data[i + 1] = y;
        this.data[i + 2] = z;
        this.data[i + 3] = color[0];
        this.data[i + 4] = color[1];
        this.data[i + 5] = color[2];
        this.data[i + 6] = color[3];
        this.floats = i + FLOATS_PER_VERTEX;
    }

    private drawSegments(
        pass: GPURenderPassEncoder,
        segments: DrawSegment[],
        withDepth: boolean,
        useExtensionFormat: boolean = false,
        sampleCount: number = 1,
    ): void {
        if (segments.length === 0) return;
        const usedBytes = this.floats * 4;
        if (usedBytes === 0) return;
        if (!this.vertexBuffer || this.vertexCapacity < usedBytes) {
            this.vertexBuffer?.destroy();
            const size = Math.max(4096, Math.ceil(usedBytes / 4096) * 4096);
            this.vertexBuffer = this.device.createBuffer({
                label: "tile-marker vertices",
                size,
                usage: GPU_BUFFER_USAGE.VERTEX | GPU_BUFFER_USAGE.COPY_DST,
            });
            this.vertexCapacity = size;
        }
        this.device.queue.writeBuffer(
            this.vertexBuffer,
            0,
            this.data.buffer,
            this.data.byteOffset,
            usedBytes,
        );

        pass.setBindGroup(0, this.sceneBindGroup);
        pass.setVertexBuffer(0, this.vertexBuffer);
        for (const segment of segments) {
            const extensionPipelines = withDepth && useExtensionFormat;
            const pipeline =
                segment.kind === "fill"
                    ? withDepth
                        ? (extensionPipelines ? this.fillDepthPipelineExt : this.fillDepthPipeline) ??
                          this.fillDepthPipeline
                        : this.fillPipeline
                    : withDepth
                      ? (extensionPipelines ? this.lineDepthPipelineExt : this.lineDepthPipeline) ??
                        this.lineDepthPipeline
                      : this.linePipeline;
            pass.setPipeline(withDepth ? withSampleCount(pipeline, sampleCount) : pipeline);
            pass.draw(segment.count, 1, segment.first, 0);
        }
    }

    private setColorFromRgb(out: number[], colorRgb: number, alpha: number): void {
        const rgb = colorRgb >>> 0;
        out[0] = ((rgb >> 16) & 0xff) / 255.0;
        out[1] = ((rgb >> 8) & 0xff) / 255.0;
        out[2] = (rgb & 0xff) / 255.0;
        out[3] = alpha;
    }

    private colorFromRgb(colorRgb: number, alpha: number): number[] {
        const out = [0, 0, 0, alpha];
        this.setColorFromRgb(out, colorRgb, alpha);
        return out;
    }
}
