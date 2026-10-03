import {
    App as PicoApp,
    DrawCall,
    PicoGL,
    Program,
    Texture,
    VertexArray,
    VertexBuffer,
} from "picogl";

import { hintArrow, isHintArrowBlinkOn } from "../../game/HintArrow";
import { IndexType } from "../../rs/cache/IndexType";
import type { CacheSystem } from "../../rs/cache/CacheSystem";
import { IndexedSprite } from "../../rs/sprite/IndexedSprite";
import { SpriteLoader } from "../../rs/sprite/SpriteLoader";
import { Overlay, OverlayInitArgs, OverlayUpdateArgs, RenderPhase } from "./Overlay";

interface TutorialHintContext {
    getCacheSystem: () => CacheSystem | undefined;
    getClient?: () => any;
    resolveNpcOverlayAnchor?: (
        ecsId: number,
        baseWorldX: number,
        baseWorldZ: number,
        npcTypeId: number,
    ) => { worldX: number; worldZ: number; logicalHeightTiles: number };
}

const SCREEN_VERT_SRC = `#version 300 es
precision highp float;
layout(location=0) in vec2 a_position;
layout(location=1) in vec2 a_texCoord;
uniform vec2 u_resolution;
out vec2 v_uv;
void main(){
    vec2 zeroToOne = a_position / u_resolution;
    vec2 zeroToTwo = zeroToOne * 2.0;
    vec2 clip = zeroToTwo - 1.0;
    gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
    v_uv = a_texCoord;
}`;
const SCREEN_FRAG_SRC = `#version 300 es
precision mediump float;
in vec2 v_uv;
uniform sampler2D u_sprite;
out vec4 fragColor;
void main(){
    fragColor = texture(u_sprite, v_uv);
}`;

/**
 * Draws the native OSRS hint arrow (`headicons_hint` frame 0) above the tile the
 * server points at. Ported from the OSRS client: project the tile, blit the
 * sprite at `(x - 12, y - 28)`, and blink it on `cycle % 20 < 10`.
 */
export class TutorialHintOverlay implements Overlay {
    constructor(
        _program: Program,
        private readonly ctx: TutorialHintContext,
    ) {}

    private app!: PicoApp;
    private positions?: VertexBuffer;
    private uvs?: VertexBuffer;
    private array?: VertexArray;
    private drawCall?: DrawCall;
    private screenProgram?: Program;

    private screenSize = new Float32Array(2);
    private quadVerts = new Float32Array(12);
    private quadUvs = new Float32Array([0, 0, 0, 1, 1, 1, 0, 0, 1, 1, 1, 0]);

    private texture?: Texture;
    private spriteW = 0;
    private spriteH = 0;
    private loadAttempted = false;
    private lastArgs?: OverlayUpdateArgs;

    /** UI-to-buffer pixel scale (uiScale x DPR), kept in sync with the other head icons. */
    scale = 1.0;

    init(args: OverlayInitArgs): void {
        this.app = args.app;
        this.positions = this.app.createVertexBuffer(PicoGL.FLOAT, 2, new Float32Array(12));
        this.uvs = this.app.createVertexBuffer(PicoGL.FLOAT, 2, new Float32Array(this.quadUvs));
        this.array = this.app
            .createVertexArray()
            .vertexAttributeBuffer(0, this.positions)
            .vertexAttributeBuffer(1, this.uvs);
        this.screenProgram = this.app.createProgram(SCREEN_VERT_SRC, SCREEN_FRAG_SRC);
        this.drawCall = this.app
            .createDrawCall(this.screenProgram, this.array)
            .uniform("u_resolution", this.screenSize)
            .primitive(PicoGL.TRIANGLES);
    }

    update(args: OverlayUpdateArgs): void {
        this.lastArgs = args;
    }

    draw(phase: RenderPhase): void {
        if (phase !== RenderPhase.ToFrameTexture) return;
        if (!this.drawCall || !this.positions || !this.uvs || !this.array) return;
        if (hintArrow.type === 0) return;

        const args = this.lastArgs;
        const helpers = args?.helpers;
        if (!helpers?.worldToScreen) return;

        if (!this.texture) {
            this.ensureTexture();
            if (!this.texture) return;
        }

        if (!isHintArrowBlinkOn()) return;

        let worldX: number;
        let worldY: number;
        let plane: number;
        let heightOffsetTiles: number;
        if (hintArrow.type === 1) {
            // Follow the rendered (interpolated) NPC like the native head icons do.
            const client = this.ctx.getClient?.();
            const npcEcs = client?.npcEcs;
            const ecsId = npcEcs?.getEcsIdForServer?.(hintArrow.npcId);
            if (ecsId === undefined || ecsId < 0) return;
            const mid = npcEcs.getMapId(ecsId) | 0;
            const typeId = npcEcs.getNpcTypeId(ecsId) | 0;
            // Native: worldToScreenActor(npc, getLogicalHeightWithAnimationOffset() + 15).
            const anchor = this.ctx.resolveNpcOverlayAnchor?.(
                ecsId,
                ((mid >> 8) & 0xff) * 64 + (npcEcs.getX(ecsId) | 0) / 128,
                (mid & 0xff) * 64 + (npcEcs.getY(ecsId) | 0) / 128,
                typeId,
            );
            if (!anchor) return;
            worldX = anchor.worldX;
            worldY = anchor.worldZ;
            plane = npcEcs.getLevel(ecsId) | 0;
            heightOffsetTiles = anchor.logicalHeightTiles + 15 / 128;
        } else {
            worldX = hintArrow.x + 0.5;
            worldY = hintArrow.y + 0.5;
            plane = hintArrow.z | 0;
            heightOffsetTiles = 0.7;
        }

        // Scene Y points down, so "up" is ground minus the offset.
        const ground =
            helpers.getMinTileHeightInRadius?.(worldX, worldY, plane, 0) ?? 0;
        const screen = helpers.worldToScreen(
            worldX,
            ground - heightOffsetTiles,
            worldY,
        ) as number[] | Float32Array | undefined;
        if (!screen || typeof screen[0] !== "number" || typeof screen[1] !== "number") return;

        // Native draws at (x - 12, y - 28) in UI pixels; scale to buffer pixels.
        const scale = Number.isFinite(this.scale) && this.scale > 0 ? this.scale : 1;
        const left = Math.round(screen[0] - 12 * scale);
        const top = Math.round(screen[1] - 28 * scale);
        const right = left + Math.round(this.spriteW * scale);
        const bottom = top + Math.round(this.spriteH * scale);

        this.quadVerts[0] = left;
        this.quadVerts[1] = top;
        this.quadVerts[2] = left;
        this.quadVerts[3] = bottom;
        this.quadVerts[4] = right;
        this.quadVerts[5] = bottom;
        this.quadVerts[6] = left;
        this.quadVerts[7] = top;
        this.quadVerts[8] = right;
        this.quadVerts[9] = bottom;
        this.quadVerts[10] = right;
        this.quadVerts[11] = top;

        this.screenSize[0] = this.app.width;
        this.screenSize[1] = this.app.height;
        this.positions.data(this.quadVerts);
        this.uvs.data(this.quadUvs);
        this.app.enable(PicoGL.BLEND);
        this.app.disable(PicoGL.DEPTH_TEST);
        this.drawCall
            .uniform("u_resolution", this.screenSize)
            .texture("u_sprite", this.texture)
            .draw();
    }

    dispose(): void {
        try {
            this.positions?.delete?.();
            this.uvs?.delete?.();
            this.array?.delete?.();
            this.drawCall?.delete?.();
            this.texture?.delete?.();
            this.screenProgram?.delete?.();
        } catch {}
    }

    private ensureTexture(): void {
        if (this.texture || this.loadAttempted) return;
        this.loadAttempted = true;
        try {
            const cache = this.ctx.getCacheSystem();
            if (!cache) return;
            const spriteIndex = cache.getIndex(IndexType.DAT2.sprites);
            const groupId = spriteIndex.getArchiveId("headicons_hint");
            if (groupId < 0) return;
            const sprites = SpriteLoader.loadIntoIndexedSprites(spriteIndex, groupId);
            const sprite = sprites?.[0];
            if (!sprite) return;
            const canvas = spriteToCanvas(sprite);
            this.texture = this.app.createTexture2D(canvas as any, {
                flipY: false,
                minFilter: PicoGL.NEAREST,
                magFilter: PicoGL.NEAREST,
                wrapS: PicoGL.CLAMP_TO_EDGE,
                wrapT: PicoGL.CLAMP_TO_EDGE,
            });
            this.spriteW = canvas.width;
            this.spriteH = canvas.height;
        } catch {
            this.texture = undefined;
        }
    }
}

function spriteToCanvas(sprite: IndexedSprite): HTMLCanvasElement {
    const width = sprite.width || sprite.subWidth;
    const height = sprite.height || sprite.subHeight;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, width);
    canvas.height = Math.max(1, height);
    const ctx = canvas.getContext("2d", {
        willReadFrequently: true as any,
    }) as CanvasRenderingContext2D;
    const img = ctx.createImageData(canvas.width, canvas.height);
    const palette = sprite.palette;
    const pixels = sprite.pixels;
    const subWidth = sprite.subWidth;
    const subHeight = sprite.subHeight;
    const ox = sprite.xOffset | 0;
    const oy = sprite.yOffset | 0;
    for (let y = 0; y < subHeight; y++) {
        for (let x = 0; x < subWidth; x++) {
            const palIndex = pixels[x + y * subWidth] & 0xff;
            if (palIndex === 0) continue;
            const dx = x + ox;
            const dy = y + oy;
            if (dx < 0 || dy < 0 || dx >= canvas.width || dy >= canvas.height) continue;
            const di = (dx + dy * canvas.width) * 4;
            const rgb = palette[palIndex];
            img.data[di] = (rgb >> 16) & 0xff;
            img.data[di + 1] = (rgb >> 8) & 0xff;
            img.data[di + 2] = rgb & 0xff;
            img.data[di + 3] = 255;
        }
    }
    ctx.putImageData(img, 0, 0);
    return canvas;
}
