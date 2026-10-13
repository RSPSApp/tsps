import type {
    App as PicoApp,
    DrawCall,
    Framebuffer,
    Program,
    Texture,
    UniformBuffer,
    VertexArray,
    VertexBuffer,
} from "picogl";

import type { Overlay, OverlayInitArgs, OverlayUpdateArgs } from "../../../ui/devoverlay/Overlay";
import { RenderPhase } from "../../../ui/devoverlay/Overlay";

const MAX_IMAGE_SIZE = 320;
const IMAGE_PADDING = 4;

const MASK_VERT_SRC = `#version 300 es
layout(std140, column_major) uniform;
precision highp float;

uniform SceneUniforms {
    mat4 u_viewProjMatrix;
    mat4 u_viewMatrix;
    mat4 u_projectionMatrix;
    vec4 u_skyColor;
    vec4 u_sceneHslOverride;
    vec2 u_cameraPos;
    vec2 u_playerPos;
    float u_renderDistance;
    float u_fogDepth;
    float u_currentTime;
    float u_brightness;
    float u_colorBanding;
    float u_isNewTextureAnim;
};

layout(location=0) in vec3 a_position;

void main() {
    gl_Position = u_projectionMatrix * (u_viewMatrix * vec4(a_position, 1.0));
}
`;

const MASK_FRAG_SRC = `#version 300 es
precision mediump float;
out vec4 fragColor;
void main() { fragColor = vec4(1.0); }
`;

type PendingCapture = {
    triangles: ReadonlyArray<readonly [number, number, number]>;
    resolve: (image: string | undefined) => void;
};

/**
 * RSPSi snapshots its isolated model canvas and crops the empty border. Here
 * the game has already rendered the selected model, so a transient silhouette
 * extracts just those pixels without adding another model renderer.
 */
export class ModelImageCaptureOverlay implements Overlay {
    private app?: PicoApp;
    private gl?: WebGL2RenderingContext;
    private sceneUniforms?: UniformBuffer;
    private program?: Program;
    private pending?: PendingCapture;

    init({ app, sceneUniforms }: OverlayInitArgs): void {
        this.app = app;
        this.gl = app.gl as WebGL2RenderingContext;
        this.sceneUniforms = sceneUniforms;
        this.program = app.createProgram(MASK_VERT_SRC, MASK_FRAG_SRC);
    }

    update(_args: OverlayUpdateArgs): void {}

    capture(
        triangles: ReadonlyArray<readonly [number, number, number]>,
    ): Promise<string | undefined> {
        if (!this.app || !this.gl || !this.sceneUniforms || !this.program || triangles.length < 3) {
            return Promise.resolve(undefined);
        }
        this.pending?.resolve(undefined);
        return new Promise((resolve) => {
            this.pending = { triangles, resolve };
        });
    }

    draw(phase: RenderPhase): void {
        if (phase !== RenderPhase.PostPresent || !this.pending) return;
        const pending = this.pending;
        this.pending = undefined;
        try {
            pending.resolve(this.capturePixels(pending.triangles));
        } catch (error) {
            console.warn("[edit] model image capture failed", error);
            pending.resolve(undefined);
        }
    }

    dispose(): void {
        this.pending?.resolve(undefined);
        this.pending = undefined;
        this.program?.delete?.();
        this.program = undefined;
    }

    private capturePixels(
        triangles: ReadonlyArray<readonly [number, number, number]>,
    ): string | undefined {
        const app = this.app;
        const gl = this.gl;
        const program = this.program;
        if (!app || !gl || !program || !this.sceneUniforms) return undefined;
        const width = app.width | 0;
        const height = app.height | 0;
        if (width <= 0 || height <= 0 || typeof document === "undefined") return undefined;

        const vertices = new Float32Array(triangles.length * 3);
        for (let index = 0; index < triangles.length; index++) {
            const point = triangles[index];
            const offset = index * 3;
            vertices[offset] = point[0];
            vertices[offset + 1] = point[1];
            vertices[offset + 2] = point[2];
        }

        let texture: Texture | undefined;
        let framebuffer: Framebuffer | undefined;
        let positions: VertexBuffer | undefined;
        let array: VertexArray | undefined;
        let drawCall: DrawCall | undefined;
        const depthTest = gl.isEnabled(gl.DEPTH_TEST);
        const blend = gl.isEnabled(gl.BLEND);
        const cullFace = gl.isEnabled(gl.CULL_FACE);
        const clearColor = gl.getParameter(gl.COLOR_CLEAR_VALUE) as Float32Array;
        try {
            texture = app.createTexture2D(width, height, {
                internalFormat: gl.RGBA8,
                minFilter: gl.NEAREST,
                magFilter: gl.NEAREST,
                wrapS: gl.CLAMP_TO_EDGE,
                wrapT: gl.CLAMP_TO_EDGE,
            });
            framebuffer = app.createFramebuffer().colorTarget(0, texture);
            positions = app.createVertexBuffer(gl.FLOAT, 3, vertices);
            array = app.createVertexArray().vertexAttributeBuffer(0, positions);
            array.numElements = triangles.length;
            drawCall = app
                .createDrawCall(program, array)
                .uniformBlock("SceneUniforms", this.sceneUniforms)
                .primitive(gl.TRIANGLES);

            app.drawFramebuffer(framebuffer);
            app.viewport(0, 0, width, height);
            app.disable(gl.DEPTH_TEST);
            app.disable(gl.BLEND);
            app.disable(gl.CULL_FACE);
            app.clearColor(0, 0, 0, 0);
            app.clear();
            drawCall.draw();

            const mask = new Uint8Array(width * height * 4);
            app.readFramebuffer(framebuffer);
            gl.readBuffer(gl.COLOR_ATTACHMENT0);
            gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, mask);
            const bounds = findOpaqueBounds(mask, width, height);
            if (!bounds) return undefined;

            const scene = new Uint8Array(width * height * 4);
            app.defaultReadFramebuffer();
            gl.readBuffer(gl.BACK);
            gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, scene);
            return cropMaskedPixels(scene, mask, width, height, bounds);
        } finally {
            app.defaultDrawFramebuffer();
            app.defaultReadFramebuffer();
            app.viewport(0, 0, width, height);
            app.clearColor(clearColor[0], clearColor[1], clearColor[2], clearColor[3]);
            if (depthTest) app.enable(gl.DEPTH_TEST);
            else app.disable(gl.DEPTH_TEST);
            if (blend) app.enable(gl.BLEND);
            else app.disable(gl.BLEND);
            if (cullFace) app.enable(gl.CULL_FACE);
            else app.disable(gl.CULL_FACE);
            drawCall?.delete?.();
            array?.delete?.();
            positions?.delete?.();
            framebuffer?.delete?.();
            texture?.delete?.();
        }
    }
}

type Bounds = { minX: number; maxX: number; minY: number; maxY: number };

export function findOpaqueBounds(pixels: Uint8Array, width: number, height: number): Bounds | undefined {
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            if (pixels[(y * width + x) * 4 + 3] === 0) continue;
            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            maxX = Math.max(maxX, x);
            maxY = Math.max(maxY, y);
        }
    }
    if (maxX < minX || maxY < minY) return undefined;
    return {
        minX: Math.max(0, minX - IMAGE_PADDING),
        maxX: Math.min(width - 1, maxX + IMAGE_PADDING),
        minY: Math.max(0, minY - IMAGE_PADDING),
        maxY: Math.min(height - 1, maxY + IMAGE_PADDING),
    };
}

export function cropMaskedPixels(
    scene: Uint8Array,
    mask: Uint8Array,
    width: number,
    height: number,
    bounds: Bounds,
): string | undefined {
    const sourceWidth = bounds.maxX - bounds.minX + 1;
    const sourceHeight = bounds.maxY - bounds.minY + 1;
    const scale = Math.min(1, MAX_IMAGE_SIZE / Math.max(sourceWidth, sourceHeight));
    const outputWidth = Math.max(1, Math.round(sourceWidth * scale));
    const outputHeight = Math.max(1, Math.round(sourceHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = outputWidth;
    canvas.height = outputHeight;
    const context = canvas.getContext("2d");
    if (!context) return undefined;
    const image = context.createImageData(outputWidth, outputHeight);
    for (let y = 0; y < outputHeight; y++) {
        const sourceY = bounds.maxY - Math.min(sourceHeight - 1, Math.floor(y / scale));
        for (let x = 0; x < outputWidth; x++) {
            const sourceX = bounds.minX + Math.min(sourceWidth - 1, Math.floor(x / scale));
            const sourceOffset = (sourceY * width + sourceX) * 4;
            const outputOffset = (y * outputWidth + x) * 4;
            image.data[outputOffset] = scene[sourceOffset];
            image.data[outputOffset + 1] = scene[sourceOffset + 1];
            image.data[outputOffset + 2] = scene[sourceOffset + 2];
            image.data[outputOffset + 3] = mask[sourceOffset + 3];
        }
    }
    context.putImageData(image, 0, 0);
    return canvas.toDataURL("image/png");
}
