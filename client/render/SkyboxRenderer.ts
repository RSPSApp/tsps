import PicoGL, { App as PicoApp, DrawCall, Program, VertexArray, VertexBuffer } from "picogl";

import type { ModelLoader } from "../rs/model/ModelLoader";
import type { TextureLoader } from "../rs/texture/TextureLoader";
import { buildSkyboxGeometry } from "./SkyboxGeometry";
import { type SkyboxStateApp, withSkyboxState } from "./SkyboxState";

/** Model units per tile: the scene draws `vertex / 128` tiles from its origin. */
const UNITS_PER_TILE = 128;

const VERT_SRC = `#version 300 es
precision highp float;
uniform mat4 u_viewProj;
uniform vec3 u_cameraPos;
layout(location=0) in vec3 a_position;
layout(location=1) in vec4 a_color;
out vec4 v_color;
void main() {
    v_color = a_color;
    gl_Position = u_viewProj * vec4(u_cameraPos + a_position / ${UNITS_PER_TILE}.0, 1.0);
}
`;

const FRAG_SRC = `#version 300 es
precision mediump float;
in vec4 v_color;
out vec4 fragColor;
void main() { fragColor = v_color; }
`;

/**
 * OSRS's cam_skybox: a cache model drawn around the camera behind the whole scene. It is
 * drawn first into the cleared scene framebuffer, without depth, so every scene face covers it.
 */
export class SkyboxRenderer {
    private modelId = -1;
    private builtModelId = -1;
    private program?: Program;
    private positions?: VertexBuffer;
    private colors?: VertexBuffer;
    private array?: VertexArray;
    private drawCall?: DrawCall;
    private vertexCount = 0;
    private readonly cameraPos = new Float32Array(3);

    constructor(
        private readonly app: PicoApp,
        private readonly loaders: () => { modelLoader?: ModelLoader; textureLoader?: TextureLoader },
    ) {}

    setModel(modelId: number): void {
        this.modelId = modelId >= 0 ? modelId : -1;
    }

    getModel(): number {
        return this.modelId;
    }

    draw(viewProjMatrix: Float32Array, cameraX: number, cameraY: number, cameraZ: number): void {
        if (this.modelId < 0 || !this.ensureGeometry() || this.vertexCount === 0 || !this.drawCall) return;
        this.cameraPos[0] = cameraX;
        this.cameraPos[1] = cameraY;
        this.cameraPos[2] = cameraZ;
        const drawCall = this.drawCall;
        withSkyboxState(this.app as unknown as SkyboxStateApp, () => {
            this.app.blendFunc(PicoGL.SRC_ALPHA, PicoGL.ONE_MINUS_SRC_ALPHA);
            drawCall.uniform("u_viewProj", viewProjMatrix).uniform("u_cameraPos", this.cameraPos).draw();
        });
    }

    dispose(): void {
        this.releaseGeometry();
        this.program?.delete();
        this.program = undefined;
    }

    /** Builds the model once per id; a model still streaming in is retried next frame. */
    private ensureGeometry(): boolean {
        if (this.builtModelId === this.modelId) return true;
        const { modelLoader, textureLoader } = this.loaders();
        if (!modelLoader || !textureLoader) return false;
        const data = modelLoader.getModel(this.modelId);
        if (!data) return false;
        const lit = data.light(textureLoader, 64, 768, -50, -10, -50);
        const geometry = buildSkyboxGeometry(lit as any);
        this.releaseGeometry();
        this.program ??= this.app.createProgram(VERT_SRC, FRAG_SRC);
        this.positions = this.app.createVertexBuffer(PicoGL.FLOAT, 3, geometry.positions);
        this.colors = this.app.createVertexBuffer(PicoGL.FLOAT, 4, geometry.colors);
        this.array = this.app.createVertexArray().vertexAttributeBuffer(0, this.positions).vertexAttributeBuffer(1, this.colors);
        this.drawCall = this.app.createDrawCall(this.program, this.array).primitive(PicoGL.TRIANGLES);
        this.vertexCount = geometry.vertexCount;
        this.builtModelId = this.modelId;
        return true;
    }

    private releaseGeometry(): void {
        this.array?.delete();
        this.positions?.delete();
        this.colors?.delete();
        this.array = this.positions = this.colors = this.drawCall = undefined;
        this.vertexCount = 0;
        this.builtModelId = -1;
    }
}
