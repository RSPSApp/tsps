// Renders the ported 3D Weather plugin's models as instanced draws over the
// finished scene. Upstream uses RuneLiteObjects; this is the engine equivalent.
import PicoGL, { type DrawCall, type Program } from "picogl";

import type { WeatherObject } from "./WeatherPlugin";
import { Weather } from "./WeatherConditions";
import { WeatherModelBuilder } from "./WeatherModelBuilder";
import type { WebGLOsrsRenderer } from "../../../render/WebGLOsrsRenderer";

const MODEL_TRANSPARENT_SWAP_DISTANCE = 3000;
const MODEL_DISAPPEAR_DISTANCE = 2500;
/** Fine units per scene tile, as RuneLite's LocalPoint uses. */
const UNITS_PER_TILE = 128;

const VERTEX_SHADER = `#version 300 es
layout(location = 0) in vec3 a_position;
layout(location = 1) in vec4 a_color;
layout(location = 2) in vec4 a_instance;

uniform mat4 u_viewProj;

out vec4 v_color;

void main() {
    // Model and world Y share the scene's convention (negative is up, as in
    // main.vert); instance y is a terrain sample in the same world-tile space.
    vec3 world = a_position / 128.0 + a_instance.xyz;
    gl_Position = u_viewProj * vec4(world, 1.0);
    v_color = a_color;
}
`;

const FRAGMENT_SHADER = `#version 300 es
precision mediump float;

in vec4 v_color;
uniform float u_alpha;
out vec4 outColor;

void main() {
    outColor = vec4(v_color.rgb, v_color.a * u_alpha);
}
`;

interface GpuRecord {
    vao: any;
    indexBuffer: any;
    positionBuffer: any;
    colorBuffer: any;
    instanceBuffer: any;
    drawCall: DrawCall;
    instanceCapacity: number;
    instanceData: Float32Array;
}

interface RendererState {
    program: Program;
    records: Map<string, GpuRecord>;
}

export interface WeatherDrawGroup {
    weather: Weather;
    objects: WeatherObject[];
}

export class WeatherRenderer {
    private readonly renderers = new Map<WebGLOsrsRenderer, RendererState>();

    constructor(private readonly builder: WeatherModelBuilder) {}

    /** Called once per renderer when the scene programs exist. */
    sceneProgramsReady(renderer: WebGLOsrsRenderer): void {
        if (this.renderers.has(renderer)) return;
        const program = renderer.app.createProgram(VERTEX_SHADER, FRAGMENT_SHADER);
        this.renderers.set(renderer, { program, records: new Map() });
    }

    disposeRenderer(renderer: WebGLOsrsRenderer): void {
        const state = this.renderers.get(renderer);
        if (!state) return;
        for (const record of state.records.values()) {
            try {
                record.drawCall?.delete?.();
                record.vao?.delete?.();
                record.instanceBuffer?.delete?.();
                record.colorBuffer?.delete?.();
                record.positionBuffer?.delete?.();
                record.indexBuffer?.delete?.();
            } catch {}
        }
        try {
            state.program?.delete?.();
        } catch {}
        this.renderers.delete(renderer);
    }

    draw(renderer: WebGLOsrsRenderer, groups: WeatherDrawGroup[], nowMs: number): void {
        const state = this.renderers.get(renderer);
        if (!state || groups.length === 0) return;

        const { camera } = renderer.osrsClient;
        const cameraTileX = camera.getPosX();
        const cameraTileZ = camera.getPosZ();

        const gl = renderer.gl;
        const blend = gl.isEnabled(PicoGL.BLEND);
        const depthTest = gl.isEnabled(PicoGL.DEPTH_TEST);
        const depthMask = gl.getParameter(gl.DEPTH_WRITEMASK) as boolean;
        const cullFace = gl.isEnabled(PicoGL.CULL_FACE);

        renderer.app.enable(PicoGL.BLEND);
        renderer.app.enable(PicoGL.DEPTH_TEST);
        renderer.app.depthMask(false);
        renderer.app.disable(PicoGL.CULL_FACE);

        try {
            const buckets = new Map<string, { weather: Weather; variant: number; transparent: boolean; frameIndex: number; objects: WeatherObject[] }>();
            for (const group of groups) {
                const transparentSwaps =
                    group.weather === Weather.CLOUDY ||
                    group.weather === Weather.PARTLY_CLOUDY ||
                    group.weather === Weather.STARRY;
                const frameCount = this.builder.getFrameCount(group.weather);
                for (const object of group.objects) {
                    let transparent = false;
                    if (transparentSwaps) {
                        const dx = (object.x - cameraTileX) * UNITS_PER_TILE;
                        const dz = (object.z - cameraTileZ) * UNITS_PER_TILE;
                        const distance = Math.sqrt(dx * dx + dz * dz);
                        if (distance < MODEL_DISAPPEAR_DISTANCE) continue;
                        transparent = distance < MODEL_TRANSPARENT_SWAP_DISTANCE;
                    }
                    const frameIndex = this.builder.frameIndexAt(group.weather, nowMs + object.phaseMs) % frameCount;
                    const key = `${group.weather}|${object.variant}|${transparent ? 1 : 0}|${frameIndex}`;
                    let bucket = buckets.get(key);
                    if (!bucket) {
                        bucket = { weather: group.weather, variant: object.variant, transparent, frameIndex, objects: [] };
                        buckets.set(key, bucket);
                    }
                    bucket.objects.push(object);
                }
            }

            for (const [key, bucket] of buckets) {
                const geometry = this.builder.getGeometry(
                    bucket.weather,
                    bucket.variant - 1,
                    bucket.transparent,
                    bucket.frameIndex,
                );
                if (!geometry) continue;
                const record = this.getRecord(renderer, state, key, geometry, bucket.objects.length);
                if (!record) continue;
                this.fillInstances(record, bucket.objects);
                record.drawCall.uniform("u_viewProj", camera.viewProjMatrix as Float32Array);
                record.drawCall.draw();
            }
        } finally {
            if (blend) renderer.app.enable(PicoGL.BLEND);
            else renderer.app.disable(PicoGL.BLEND);
            if (depthTest) renderer.app.enable(PicoGL.DEPTH_TEST);
            else renderer.app.disable(PicoGL.DEPTH_TEST);
            renderer.app.depthMask(depthMask);
            if (cullFace) renderer.app.enable(PicoGL.CULL_FACE);
        }
    }

    private getRecord(
        renderer: WebGLOsrsRenderer,
        state: RendererState,
        key: string,
        geometry: { positions: Float32Array; colors: Uint8Array; indices: Uint32Array },
        instanceCount: number,
    ): GpuRecord | undefined {
        const app = renderer.app;
        const capacity = Math.max(16, instanceCount);
        let record = state.records.get(key);
        if (!record) {
            const positionBuffer = app.createVertexBuffer(PicoGL.FLOAT, 3, geometry.positions);
            const colorBuffer = app.createVertexBuffer(PicoGL.UNSIGNED_BYTE, 4, geometry.colors);
            const indexBuffer = app.createIndexBuffer(PicoGL.UNSIGNED_INT, geometry.indices);
            const instanceData = new Float32Array(capacity * 4);
            const instanceBuffer = app.createVertexBuffer(PicoGL.FLOAT, 4, instanceData);
            const vao = app
                .createVertexArray()
                .vertexAttributeBuffer(0, positionBuffer)
                .vertexAttributeBuffer(1, colorBuffer, { normalized: true } as any)
                .instanceAttributeBuffer(2, instanceBuffer)
                .indexBuffer(indexBuffer);
            const drawCall = app.createDrawCall(state.program, vao);
            drawCall.uniform("u_alpha", 1.0);
            record = {
                vao,
                indexBuffer,
                positionBuffer,
                colorBuffer,
                instanceBuffer,
                drawCall,
                instanceCapacity: capacity,
                instanceData,
            };
            state.records.set(key, record);
        } else if (instanceCount > record.instanceCapacity) {
            record.instanceCapacity = instanceCount;
            record.instanceData = new Float32Array(instanceCount * 4);
            record.instanceBuffer.delete();
            record.instanceBuffer = app.createVertexBuffer(PicoGL.FLOAT, 4, record.instanceData);
            record.vao.delete();
            record.vao = app
                .createVertexArray()
                .vertexAttributeBuffer(0, record.positionBuffer)
                .vertexAttributeBuffer(1, record.colorBuffer, { normalized: true } as any)
                .instanceAttributeBuffer(2, record.instanceBuffer)
                .indexBuffer(record.indexBuffer);
            // DrawCall holds no GPU resource (PicoGL has no delete for it); just replace it.
            record.drawCall = app.createDrawCall(state.program, record.vao);
            record.drawCall.uniform("u_alpha", 1.0);
        }
        return record;
    }

    private fillInstances(record: GpuRecord, objects: WeatherObject[]): void {
        const data = record.instanceData;
        for (let i = 0; i < objects.length; i++) {
            const object = objects[i];
            const offset = i * 4;
            data[offset] = object.x;
            data[offset + 1] = object.y;
            data[offset + 2] = object.z;
            data[offset + 3] = 0;
        }
        (record.instanceBuffer as any).data(data.subarray(0, objects.length * 4));
        (record.vao as any).numInstances = Math.max(1, objects.length);
    }
}
