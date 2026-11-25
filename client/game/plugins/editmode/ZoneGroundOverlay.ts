import type {
    App as PicoApp,
    DrawCall,
    Program,
    UniformBuffer,
    VertexArray,
    VertexBuffer,
} from "picogl";

import type { Overlay, OverlayInitArgs, OverlayUpdateArgs } from "../../../ui/devoverlay/Overlay";
import { RenderPhase } from "../../../ui/devoverlay/Overlay";
import { getOverlayShapeTriangles } from "../../../rs/scene/SceneTileModel";

export interface ZoneGroundRect {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    plane: number;
    colorRgb: number;
    alpha: number;
    /** A flat editor preview plane instead of sampling the existing terrain. */
    height?: number;
    shape?: number;
    rotation?: number;
}

// World Y is negative-up, so this holds the overlay above the terrain.
const TERRAIN_CLEARANCE = 0.05;
const RECT_TRIANGLES: readonly (readonly (readonly [number, number])[])[] = [
    [[0, 0], [1, 0], [1, 1]], [[0, 0], [1, 1], [0, 1]],
];
const SHAPE_TRIANGLES = Array.from({ length: 12 }, (_, shape) =>
    Array.from({ length: 4 }, (_, rotation) => getOverlayShapeTriangles(shape, rotation)),
);

function getGroundTriangles(rect: ZoneGroundRect): typeof RECT_TRIANGLES {
    return rect.shape === undefined ? RECT_TRIANGLES : SHAPE_TRIANGLES[rect.shape]?.[rect.rotation ?? 0] ?? RECT_TRIANGLES;
}

const VERT_SRC = `#version 300 es
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
layout(location=1) in vec4 a_color;
out vec4 v_color;
out float v_fogAmount;
void main() {
    gl_Position = u_projectionMatrix * (u_viewMatrix * vec4(a_position, 1.0));
    v_color = a_color;
    float distanceFromPlayer = max(
        abs(a_position.x - u_playerPos.x),
        abs(a_position.z - u_playerPos.y)
    );
    float fogStart = min(u_fogDepth, u_renderDistance);
    float fogWidth = max(u_renderDistance - fogStart, 0.0001);
    v_fogAmount = clamp((distanceFromPlayer - fogStart) / fogWidth, 0.0, 1.0);
}`;

const FRAG_SRC = `#version 300 es
precision mediump float;
in vec4 v_color;
in float v_fogAmount;
out vec4 fragColor;
void main() {
    fragColor = vec4(v_color.rgb, v_color.a * (1.0 - smoothstep(0.0, 1.0, v_fogAmount)));
    if (fragColor.a < 0.005) discard;
}`;

export function buildZoneGroundGeometry(
    rects: readonly ZoneGroundRect[],
    sampleHeight: (x: number, y: number, plane: number) => number,
): { positions: Float32Array; colors: Float32Array } {
    const vertexCapacity = rects.reduce(
        (total, rect) =>
            total +
            Math.max(0, rect.maxX - rect.minX + 1) *
                Math.max(0, rect.maxY - rect.minY + 1) * getGroundTriangles(rect).length * 3,
        0,
    );
    const positions = new Float32Array(vertexCapacity * 3);
    const colors = new Float32Array(vertexCapacity * 4);
    const seen = new Set<string>();
    let positionOffset = 0;
    let colorOffset = 0;

    for (const rect of rects) {
        const red = ((rect.colorRgb >> 16) & 0xff) / 255;
        const green = ((rect.colorRgb >> 8) & 0xff) / 255;
        const blue = (rect.colorRgb & 0xff) / 255;
        const triangles = getGroundTriangles(rect);
        for (let x = rect.minX; x <= rect.maxX; x++) {
            for (let y = rect.minY; y <= rect.maxY; y++) {
                const key = `${x}:${y}:${rect.plane}:${rect.colorRgb}`;
                if (seen.has(key)) continue;
                seen.add(key);
                const height = rect.height;
                const sw = height ?? sampleHeight(x, y, rect.plane);
                const se = height ?? sampleHeight(x + 1, y, rect.plane);
                const ne = height ?? sampleHeight(x + 1, y + 1, rect.plane);
                const nw = height ?? sampleHeight(x, y + 1, rect.plane);
                for (const triangle of triangles) {
                    for (const [dx, dy] of triangle) {
                        positions[positionOffset++] = x + dx;
                        positions[positionOffset++] = sw + (se - sw) * dx + (nw - sw) * dy + (ne + sw - se - nw) * dx * dy - TERRAIN_CLEARANCE;
                        positions[positionOffset++] = y + dy;
                        colors[colorOffset++] = red;
                        colors[colorOffset++] = green;
                        colors[colorOffset++] = blue;
                        colors[colorOffset++] = rect.alpha;
                    }
                }
            }
        }
    }
    return {
        positions: positions.subarray(0, positionOffset),
        colors: colors.subarray(0, colorOffset),
    };
}

export class ZoneGroundOverlay implements Overlay {
    private app?: PicoApp;
    private gl?: WebGL2RenderingContext;
    private sceneUniforms?: UniformBuffer;
    private positions?: VertexBuffer;
    private colors?: VertexBuffer;
    private array?: VertexArray;
    private drawCall?: DrawCall;
    private program?: Program;
    private args?: OverlayUpdateArgs;
    private rects: readonly ZoneGroundRect[] = [];
    private rectKey = "";
    private dirty = true;
    private vertexCapacity = 0;

    constructor(private readonly depthTest = true) {}

    setRects(rects: readonly ZoneGroundRect[]): void {
        const key = rects
            .map((rect) =>
                [
                    rect.minX,
                    rect.maxX,
                    rect.minY,
                    rect.maxY,
                    rect.plane,
                    rect.colorRgb,
                    rect.alpha,
                    rect.height,
                    rect.shape,
                    rect.rotation,
                ].join(":"),
            )
            .join(";");
        if (key === this.rectKey) return;
        this.rectKey = key;
        this.rects = rects;
        this.dirty = true;
    }

    invalidate(): void {
        this.dirty = true;
    }

    init({ app, sceneUniforms }: OverlayInitArgs): void {
        this.app = app;
        this.gl = app.gl as WebGL2RenderingContext;
        this.sceneUniforms = sceneUniforms;
        this.program = app.createProgram(VERT_SRC, FRAG_SRC);
        this.ensureCapacity(6);
    }

    update(args: OverlayUpdateArgs): void {
        this.args = args;
    }

    draw(phase: RenderPhase): void {
        if (
            phase !== RenderPhase.ToSceneFramebuffer ||
            !this.app ||
            !this.gl ||
            !this.args ||
            !this.array ||
            !this.drawCall
        ) {
            return;
        }
        if (this.dirty) {
            const geometry = buildZoneGroundGeometry(
                this.rects,
                this.args.helpers.sampleHeightAtExactPlane,
            );
            const vertexCount = geometry.positions.length / 3;
            this.ensureCapacity(vertexCount);
            if (vertexCount > 0) {
                this.positions!.data(geometry.positions);
                this.colors!.data(geometry.colors);
            }
            this.positions!.numItems = vertexCount;
            this.colors!.numItems = vertexCount;
            this.array!.numElements = vertexCount;
            this.dirty = false;
        }
        if (this.array.numElements === 0) return;

        if (this.depthTest) this.app.enable(this.gl.DEPTH_TEST);
        else this.app.disable(this.gl.DEPTH_TEST);
        this.app.depthMask(false);
        this.app.disable(this.gl.CULL_FACE as any);
        this.app.enable(this.gl.BLEND);
        this.app.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE_MINUS_SRC_ALPHA);
        this.drawCall.draw();
        this.app.depthMask(true);
        this.app.disable(this.gl.BLEND);
        this.app.enable(this.gl.DEPTH_TEST);
    }

    dispose(): void {
        this.positions?.delete?.();
        this.colors?.delete?.();
        this.array?.delete?.();
        this.program?.delete?.();
    }

    private ensureCapacity(vertexCount: number): void {
        if (
            vertexCount <= this.vertexCapacity ||
            !this.app ||
            !this.gl ||
            !this.sceneUniforms ||
            !this.program
        ) {
            return;
        }
        this.positions?.delete?.();
        this.colors?.delete?.();
        this.array?.delete?.();
        this.vertexCapacity = 2 ** Math.ceil(Math.log2(Math.max(6, vertexCount)));
        this.positions = this.app.createVertexBuffer(
            this.gl.FLOAT,
            3,
            new Float32Array(this.vertexCapacity * 3),
            this.gl.DYNAMIC_DRAW,
        );
        this.colors = this.app.createVertexBuffer(
            this.gl.FLOAT,
            4,
            new Float32Array(this.vertexCapacity * 4),
            this.gl.DYNAMIC_DRAW,
        );
        this.array = this.app
            .createVertexArray()
            .vertexAttributeBuffer(0, this.positions)
            .vertexAttributeBuffer(1, this.colors);
        this.array.numElements = 0;
        this.drawCall = this.app
            .createDrawCall(this.program, this.array)
            .uniformBlock("SceneUniforms", this.sceneUniforms)
            .primitive(this.gl.TRIANGLES);
    }
}
