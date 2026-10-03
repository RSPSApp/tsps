/**
 * MinimapRenderer - WebGL-based minimap rendering
 *
 * Renders the minimap entirely on the GPU with:
 * - Rotation transform in vertex shader
 * - Sprite-mask clipping in fragment shader
 * - Batched sprite rendering for dots
 */
import { createProgram } from "./gl-utils";
import type { WebGLOsrsRenderer } from "../../render/WebGLOsrsRenderer";

/** Image and icon coordinates share the same scene bounds. */
export function getMinimapMaps(
    renderer: Pick<WebGLOsrsRenderer, "instanceActive" | "mapManager"> | undefined,
    tileX: number,
    tileY: number,
): Array<{ mapX: number; mapY: number; baseX: number; baseY: number; size: number }> {
    if (renderer?.instanceActive) {
        const map = renderer.mapManager.getMapForWorldTile(tileX, tileY);
        return map ? [{
            mapX: map.mapX, mapY: map.mapY,
            baseX: map.getRenderBaseTileX(), baseY: map.getRenderBaseTileY(),
            size: map.getLocalTileSpan(),
        }] : [];
    }
    const maps = [];
    for (let x = (tileX >> 6) - 1; x <= (tileX >> 6) + 1; x++) {
        for (let y = (tileY >> 6) - 1; y <= (tileY >> 6) + 1; y++) {
            maps.push({ mapX: x, mapY: y, baseX: x * 64, baseY: y * 64, size: 64 });
        }
    }
    return maps;
}

// Vertex shader for minimap tiles and sprites
// Applies rotation around the minimap center
const VS_MINIMAP = `#version 300 es
precision highp float;

layout(location=0) in vec2 aPos;      // Position relative to minimap center (pre-rotation)
layout(location=1) in vec2 aUV;       // Texture coordinates

uniform mat4 uProj;                   // Orthographic projection
uniform vec2 uCenter;                 // Minimap center on screen
uniform float uSin;                   // sin(rotation angle)
uniform float uCos;                   // cos(rotation angle)
uniform float uZoom;                  // Zoom scale factor

out vec2 vUV;
out vec2 vScreenPos;

void main() {
    // Apply rotation around origin (minimap-relative coords)
    vec2 rotated;
    rotated.x = aPos.x * uCos - aPos.y * uSin;
    rotated.y = aPos.x * uSin + aPos.y * uCos;

    // Scale by zoom and translate to screen position
    vec2 screenPos = uCenter + rotated * uZoom;

    vUV = aUV;
    vScreenPos = screenPos;
    gl_Position = uProj * vec4(screenPos, 0.0, 1.0);
}`;

// Fragment shader with widget SpriteMask clipping
const FS_MINIMAP = `#version 300 es
precision highp float;

in vec2 vUV;
in vec2 vScreenPos;

uniform sampler2D uTexture;
uniform sampler2D uMaskTexture;
uniform vec2 uCenter;                 // Minimap center on screen
uniform float uRadius;                // Circular clip radius
uniform float uAlpha;                 // Overall alpha
uniform vec4 uMaskBounds;             // x, y, width, height
uniform int uUseMask;

out vec4 fragColor;

void main() {
    float edge = 1.0;
    if (uUseMask != 0) {
        vec2 maskUV = (vScreenPos - uMaskBounds.xy) / uMaskBounds.zw;
        if (maskUV.x < 0.0 || maskUV.x > 1.0 || maskUV.y < 0.0 || maskUV.y > 1.0) {
            discard;
        }
        vec4 mask = texture(uMaskTexture, maskUV);
        if (mask.a > 0.5) {
            discard;
        }
    } else {
        float dist = length(vScreenPos - uCenter);
        if (dist > uRadius) {
            discard;
        }
        edge = smoothstep(uRadius, uRadius - 1.5, dist);
    }

    vec4 color = texture(uTexture, vUV);
    color.a *= uAlpha * edge;
    fragColor = color;
}`;

// Vertex shader for unrotated elements (flag, player marker)
// These stay upright regardless of map rotation
const VS_OVERLAY = `#version 300 es
precision highp float;

layout(location=0) in vec2 aPos;
layout(location=1) in vec2 aUV;

uniform mat4 uProj;

out vec2 vUV;
out vec2 vScreenPos;

void main() {
    vUV = aUV;
    vScreenPos = aPos;
    gl_Position = uProj * vec4(aPos, 0.0, 1.0);
}`;

// Fragment shader for overlay (with circular clipping)
const FS_OVERLAY = `#version 300 es
precision highp float;

in vec2 vUV;
in vec2 vScreenPos;

uniform sampler2D uTexture;
uniform sampler2D uMaskTexture;
uniform vec2 uCenter;
uniform float uRadius;
uniform float uAlpha;
uniform vec4 uMaskBounds;
uniform int uUseMask;

out vec4 fragColor;

void main() {
    if (uUseMask != 0) {
        vec2 maskUV = (vScreenPos - uMaskBounds.xy) / uMaskBounds.zw;
        if (maskUV.x < 0.0 || maskUV.x > 1.0 || maskUV.y < 0.0 || maskUV.y > 1.0) {
            discard;
        }
        vec4 mask = texture(uMaskTexture, maskUV);
        if (mask.a > 0.5) {
            discard;
        }
    } else {
        float dist = length(vScreenPos - uCenter);
        if (dist > uRadius) {
            discard;
        }
    }

    vec4 color = texture(uTexture, vUV);
    color.a *= uAlpha;
    fragColor = color;
}`;

// Solid color shader for player marker
const VS_SOLID = `#version 300 es
precision highp float;

layout(location=0) in vec2 aPos;

uniform mat4 uProj;

out vec2 vScreenPos;

void main() {
    vScreenPos = aPos;
    gl_Position = uProj * vec4(aPos, 0.0, 1.0);
}`;

const FS_SOLID = `#version 300 es
precision highp float;

in vec2 vScreenPos;

uniform vec4 uColor;
uniform vec2 uCenter;
uniform float uRadius;
uniform sampler2D uMaskTexture;
uniform vec4 uMaskBounds;
uniform int uUseMask;

out vec4 fragColor;

void main() {
    if (uUseMask != 0) {
        vec2 maskUV = (vScreenPos - uMaskBounds.xy) / uMaskBounds.zw;
        if (maskUV.x < 0.0 || maskUV.x > 1.0 || maskUV.y < 0.0 || maskUV.y > 1.0) {
            discard;
        }
        vec4 mask = texture(uMaskTexture, maskUV);
        if (mask.a > 0.5) {
            discard;
        }
    } else {
        float dist = length(vScreenPos - uCenter);
        if (dist > uRadius) {
            discard;
        }
    }
    fragColor = uColor;
}`;

export interface MinimapTexture {
    tex: WebGLTexture;
    w: number;
    h: number;
}

export interface MinimapRenderMask {
    tex: WebGLTexture;
    x: number;
    y: number;
    width: number;
    height: number;
}

interface DotInstance {
    x: number; // Position relative to player (in pixels, pre-rotation)
    y: number;
    tex: MinimapTexture;
    scale: number;
}

export class MinimapRenderer {
    private gl: WebGL2RenderingContext;
    private proj: Float32Array;

    // Shader programs
    private progMinimap!: WebGLProgram;
    private progOverlay!: WebGLProgram;
    private progSolid!: WebGLProgram;

    // Uniform locations - Minimap
    private uProj_mm!: WebGLUniformLocation;
    private uCenter_mm!: WebGLUniformLocation;
    private uSin_mm!: WebGLUniformLocation;
    private uCos_mm!: WebGLUniformLocation;
    private uZoom_mm!: WebGLUniformLocation;
    private uTexture_mm!: WebGLUniformLocation;
    private uRadius_mm!: WebGLUniformLocation;
    private uAlpha_mm!: WebGLUniformLocation;
    private uMaskTexture_mm!: WebGLUniformLocation;
    private uMaskBounds_mm!: WebGLUniformLocation;
    private uUseMask_mm!: WebGLUniformLocation;

    // Uniform locations - Overlay
    private uProj_ov!: WebGLUniformLocation;
    private uCenter_ov!: WebGLUniformLocation;
    private uRadius_ov!: WebGLUniformLocation;
    private uTexture_ov!: WebGLUniformLocation;
    private uAlpha_ov!: WebGLUniformLocation;
    private uMaskTexture_ov!: WebGLUniformLocation;
    private uMaskBounds_ov!: WebGLUniformLocation;
    private uUseMask_ov!: WebGLUniformLocation;

    // Uniform locations - Solid
    private uProj_solid!: WebGLUniformLocation;
    private uCenter_solid!: WebGLUniformLocation;
    private uRadius_solid!: WebGLUniformLocation;
    private uColor_solid!: WebGLUniformLocation;
    private uMaskTexture_solid!: WebGLUniformLocation;
    private uMaskBounds_solid!: WebGLUniformLocation;
    private uUseMask_solid!: WebGLUniformLocation;

    // Buffers
    private vbo!: WebGLBuffer;
    private ibo!: WebGLBuffer;
    private vao!: WebGLVertexArrayObject;

    // Batching for dots
    private dotBuffer: Float32Array;
    private dotInstances: DotInstance[] = [];
    private maxDots = 256;
    /** Reused 4-vert × 4-float quad; avoids per-draw Float32Array allocs on every minimap tile/dot. */
    private quadVerts = new Float32Array(16);

    // Current state
    private centerX = 0;
    private centerY = 0;
    private radius = 76;
    private sin = 0;
    private cos = 1;
    private zoom = 1;
    private mask: MinimapRenderMask | null = null;

    constructor(gl: WebGL2RenderingContext, proj: Float32Array) {
        this.gl = gl;
        this.proj = proj;
        this.dotBuffer = new Float32Array(this.maxDots * 4 * 4); // 4 verts * 4 floats per dot
        this.init();
    }

    private init() {
        const gl = this.gl;

        // Create programs
        this.progMinimap = createProgram(gl, VS_MINIMAP, FS_MINIMAP);
        this.progOverlay = createProgram(gl, VS_OVERLAY, FS_OVERLAY);
        this.progSolid = createProgram(gl, VS_SOLID, FS_SOLID);

        // Get uniform locations - Minimap
        this.uProj_mm = gl.getUniformLocation(this.progMinimap, "uProj")!;
        this.uCenter_mm = gl.getUniformLocation(this.progMinimap, "uCenter")!;
        this.uSin_mm = gl.getUniformLocation(this.progMinimap, "uSin")!;
        this.uCos_mm = gl.getUniformLocation(this.progMinimap, "uCos")!;
        this.uZoom_mm = gl.getUniformLocation(this.progMinimap, "uZoom")!;
        this.uTexture_mm = gl.getUniformLocation(this.progMinimap, "uTexture")!;
        this.uRadius_mm = gl.getUniformLocation(this.progMinimap, "uRadius")!;
        this.uAlpha_mm = gl.getUniformLocation(this.progMinimap, "uAlpha")!;
        this.uMaskTexture_mm = gl.getUniformLocation(this.progMinimap, "uMaskTexture")!;
        this.uMaskBounds_mm = gl.getUniformLocation(this.progMinimap, "uMaskBounds")!;
        this.uUseMask_mm = gl.getUniformLocation(this.progMinimap, "uUseMask")!;

        // Get uniform locations - Overlay
        this.uProj_ov = gl.getUniformLocation(this.progOverlay, "uProj")!;
        this.uCenter_ov = gl.getUniformLocation(this.progOverlay, "uCenter")!;
        this.uRadius_ov = gl.getUniformLocation(this.progOverlay, "uRadius")!;
        this.uTexture_ov = gl.getUniformLocation(this.progOverlay, "uTexture")!;
        this.uAlpha_ov = gl.getUniformLocation(this.progOverlay, "uAlpha")!;
        this.uMaskTexture_ov = gl.getUniformLocation(this.progOverlay, "uMaskTexture")!;
        this.uMaskBounds_ov = gl.getUniformLocation(this.progOverlay, "uMaskBounds")!;
        this.uUseMask_ov = gl.getUniformLocation(this.progOverlay, "uUseMask")!;

        // Get uniform locations - Solid
        this.uProj_solid = gl.getUniformLocation(this.progSolid, "uProj")!;
        this.uCenter_solid = gl.getUniformLocation(this.progSolid, "uCenter")!;
        this.uRadius_solid = gl.getUniformLocation(this.progSolid, "uRadius")!;
        this.uColor_solid = gl.getUniformLocation(this.progSolid, "uColor")!;
        this.uMaskTexture_solid = gl.getUniformLocation(this.progSolid, "uMaskTexture")!;
        this.uMaskBounds_solid = gl.getUniformLocation(this.progSolid, "uMaskBounds")!;
        this.uUseMask_solid = gl.getUniformLocation(this.progSolid, "uUseMask")!;

        // Create buffers
        this.vbo = gl.createBuffer()!;
        this.ibo = gl.createBuffer()!;

        // Index buffer for quad
        const indices = new Uint16Array([0, 1, 2, 0, 2, 3]);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);

        // VAO setup
        this.vao = gl.createVertexArray()!;
        gl.bindVertexArray(this.vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
        // aPos (location=0): 2 floats
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 16, 0);
        // aUV (location=1): 2 floats
        gl.enableVertexAttribArray(1);
        gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 16, 8);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
        gl.bindVertexArray(null);
    }

    private bindNearestTexture(tex: WebGLTexture): void {
        const gl = this.gl;
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }

    private bindMask(
        uUseMask: WebGLUniformLocation,
        uMaskTexture: WebGLUniformLocation,
        uMaskBounds: WebGLUniformLocation,
    ): void {
        const gl = this.gl;
        const mask = this.mask;
        gl.uniform1i(uUseMask, mask ? 1 : 0);
        if (!mask) return;
        gl.activeTexture(gl.TEXTURE1);
        this.bindNearestTexture(mask.tex);
        gl.uniform1i(uMaskTexture, 1);
        gl.uniform4f(uMaskBounds, mask.x, mask.y, mask.width, mask.height);
    }

    /**
     * Update projection matrix (call when screen resizes)
     */
    updateProj(proj: Float32Array) {
        this.proj = proj;
    }

    /**
     * Begin rendering a frame - set up minimap parameters
     */
    begin(
        centerX: number,
        centerY: number,
        radius: number,
        cameraYaw: number,
        zoom: number,
        mask: MinimapRenderMask | null = null,
    ) {
        this.centerX = centerX;
        this.centerY = centerY;
        this.radius = radius;
        this.zoom = zoom;
        this.mask = mask;

        // OSRS: angle / 326.11 = radians, negative for minimap rotation
        const radians = -cameraYaw / 326.11;
        this.sin = Math.sin(radians);
        this.cos = Math.cos(radians);

        this.dotInstances.length = 0;
    }

    /**
     * Draw a map tile texture
     * @param tex Map tile texture
     * @param relX Tile position relative to player center (in minimap pixels)
     * @param relY Tile position relative to player center (in minimap pixels)
     * @param size Tile size in minimap pixels
     */
    drawTile(tex: MinimapTexture, relX: number, relY: number, size: number) {
        const gl = this.gl;

        gl.useProgram(this.progMinimap);
        gl.uniformMatrix4fv(this.uProj_mm, false, this.proj);
        gl.uniform2f(this.uCenter_mm, this.centerX, this.centerY);
        gl.uniform1f(this.uSin_mm, this.sin);
        gl.uniform1f(this.uCos_mm, this.cos);
        gl.uniform1f(this.uZoom_mm, this.zoom);
        gl.uniform1f(this.uRadius_mm, this.radius);
        gl.uniform1f(this.uAlpha_mm, 1.0);
        this.bindMask(this.uUseMask_mm, this.uMaskTexture_mm, this.uMaskBounds_mm);

        gl.activeTexture(gl.TEXTURE0);
        this.bindNearestTexture(tex.tex);
        gl.uniform1i(this.uTexture_mm, 0);

        // Quad vertices: position relative to minimap center + UV
        const x0 = relX;
        const y0 = relY;
        const x1 = relX + size;
        const y1 = relY + size;

        const verts = this.quadVerts;
        verts[0] = x0;
        verts[1] = y0;
        verts[2] = 0;
        verts[3] = 0;
        verts[4] = x1;
        verts[5] = y0;
        verts[6] = 1;
        verts[7] = 0;
        verts[8] = x1;
        verts[9] = y1;
        verts[10] = 1;
        verts[11] = 1;
        verts[12] = x0;
        verts[13] = y1;
        verts[14] = 0;
        verts[15] = 1;

        gl.bindVertexArray(this.vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
        gl.bufferData(gl.ARRAY_BUFFER, verts, gl.DYNAMIC_DRAW);
        gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
    }

    /**
     * Queue a dot sprite for batched drawing
     */
    queueDot(tex: MinimapTexture, relX: number, relY: number, scale: number = 1) {
        this.dotInstances.push({ x: relX, y: relY, tex, scale });
    }

    /**
     * Flush all queued dots - draws them batched by texture
     */
    flushDots() {
        if (this.dotInstances.length === 0) return;

        const gl = this.gl;

        gl.useProgram(this.progOverlay);
        gl.uniformMatrix4fv(this.uProj_ov, false, this.proj);
        gl.uniform2f(this.uCenter_ov, this.centerX, this.centerY);
        gl.uniform1f(this.uRadius_ov, this.radius);
        gl.uniform1f(this.uAlpha_ov, 1.0);
        this.bindMask(this.uUseMask_ov, this.uMaskTexture_ov, this.uMaskBounds_ov);

        gl.bindVertexArray(this.vao);

        // Group dots by texture for batching
        const byTex = new Map<WebGLTexture, DotInstance[]>();
        for (const dot of this.dotInstances) {
            const arr = byTex.get(dot.tex.tex);
            if (arr) {
                arr.push(dot);
            } else {
                byTex.set(dot.tex.tex, [dot]);
            }
        }

        // Draw each texture batch
        for (const [texId, dots] of byTex) {
            gl.activeTexture(gl.TEXTURE0);
            this.bindNearestTexture(texId);
            gl.uniform1i(this.uTexture_ov, 0);

            for (const dot of dots) {
                const screen = this.relativeToScreen(dot.x, dot.y);
                const spriteW = dot.tex.w * dot.scale;
                const spriteH = dot.tex.h * dot.scale;
                const halfW = spriteW / 2;
                const halfH = spriteH / 2;
                const x0 = screen.x - halfW;
                const y0 = screen.y - halfH;
                const x1 = screen.x + halfW;
                const y1 = screen.y + halfH;

                const verts = this.quadVerts;
                verts[0] = x0;
                verts[1] = y0;
                verts[2] = 0;
                verts[3] = 0;
                verts[4] = x1;
                verts[5] = y0;
                verts[6] = 1;
                verts[7] = 0;
                verts[8] = x1;
                verts[9] = y1;
                verts[10] = 1;
                verts[11] = 1;
                verts[12] = x0;
                verts[13] = y1;
                verts[14] = 0;
                verts[15] = 1;

                gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
                gl.bufferData(gl.ARRAY_BUFFER, verts, gl.DYNAMIC_DRAW);
                gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
            }
        }

        this.dotInstances.length = 0;
    }

    /**
     * Draw an overlay element (upright unless `angle` is given)
     * Position is given in rotated minimap coordinates; pivot is in scaled sprite pixels
     */
    drawOverlay(
        tex: MinimapTexture,
        screenX: number,
        screenY: number,
        width?: number,
        height?: number,
        angle = 0,
        pivotX?: number,
        pivotY?: number,
    ) {
        const gl = this.gl;
        const w = width ?? tex.w;
        const h = height ?? tex.h;

        gl.useProgram(this.progOverlay);
        gl.uniformMatrix4fv(this.uProj_ov, false, this.proj);
        gl.uniform2f(this.uCenter_ov, this.centerX, this.centerY);
        gl.uniform1f(this.uRadius_ov, this.radius);
        gl.uniform1f(this.uAlpha_ov, 1.0);
        this.bindMask(this.uUseMask_ov, this.uMaskTexture_ov, this.uMaskBounds_ov);

        gl.activeTexture(gl.TEXTURE0);
        this.bindNearestTexture(tex.tex);
        gl.uniform1i(this.uTexture_ov, 0);

        // Sprite pixel (pivotX, pivotY) lands on the pivot point; corners are
        // rotated clockwise (screen y-down) by `angle` around it.
        const px = pivotX ?? w / 2;
        const py = pivotY ?? h / 2;
        const sin = Math.sin(angle);
        const cos = Math.cos(angle);
        const verts = this.quadVerts;
        const corners = [0, 0, 1, 0, 1, 1, 0, 1];
        for (let i = 0; i < 4; i++) {
            const u = corners[i * 2];
            const v = corners[i * 2 + 1];
            const ox = u * w - px;
            const oy = v * h - py;
            verts[i * 4] = screenX + ox * cos - oy * sin;
            verts[i * 4 + 1] = screenY + ox * sin + oy * cos;
            verts[i * 4 + 2] = u;
            verts[i * 4 + 3] = v;
        }

        gl.bindVertexArray(this.vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
        gl.bufferData(gl.ARRAY_BUFFER, verts, gl.DYNAMIC_DRAW);
        gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
    }

    /**
     * Draw a solid colored rectangle (for player marker)
     */
    drawSolidRect(
        screenX: number,
        screenY: number,
        width: number,
        height: number,
        color: [number, number, number, number],
    ) {
        const gl = this.gl;

        gl.useProgram(this.progSolid);
        gl.uniformMatrix4fv(this.uProj_solid, false, this.proj);
        gl.uniform2f(this.uCenter_solid, this.centerX, this.centerY);
        gl.uniform1f(this.uRadius_solid, this.radius);
        gl.uniform4fv(this.uColor_solid, color);
        this.bindMask(this.uUseMask_solid, this.uMaskTexture_solid, this.uMaskBounds_solid);

        const x0 = screenX - width / 2;
        const y0 = screenY - height / 2;
        const x1 = screenX + width / 2;
        const y1 = screenY + height / 2;

        // For solid shader, we only need position (no UV)
        // But VAO expects 16 bytes stride, so pad with zeros
        const verts = this.quadVerts;
        verts[0] = x0;
        verts[1] = y0;
        verts[2] = 0;
        verts[3] = 0;
        verts[4] = x1;
        verts[5] = y0;
        verts[6] = 0;
        verts[7] = 0;
        verts[8] = x1;
        verts[9] = y1;
        verts[10] = 0;
        verts[11] = 0;
        verts[12] = x0;
        verts[13] = y1;
        verts[14] = 0;
        verts[15] = 0;

        gl.bindVertexArray(this.vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
        gl.bufferData(gl.ARRAY_BUFFER, verts, gl.DYNAMIC_DRAW);
        gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
    }

    /**
     * Transform a relative position to screen position (applying rotation and zoom)
     * Used for positioning overlay elements like the flag
     */
    relativeToScreen(relX: number, relY: number): { x: number; y: number } {
        // Apply rotation
        const rotX = relX * this.cos - relY * this.sin;
        const rotY = relX * this.sin + relY * this.cos;

        // Apply zoom and translate to screen
        return {
            x: this.centerX + rotX * this.zoom,
            y: this.centerY + rotY * this.zoom,
        };
    }

    /**
     * Get current minimap center
     */
    getCenter(): { x: number; y: number } {
        return { x: this.centerX, y: this.centerY };
    }

    /**
     * Get current minimap radius
     */
    getRadius(): number {
        return this.radius;
    }
}
