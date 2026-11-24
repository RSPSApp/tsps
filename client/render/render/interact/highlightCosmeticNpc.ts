import { sampleActorHeightForWorldTile } from "../../../game/scene/BridgeHeightSampler";
import { RS_TO_RADIANS } from "../../../rs/MathConstants";
import { RENDER_CONSTANTS, type CosmeticNpcHighlightTarget } from "../constants";
import type { WebGLOsrsRendererHost } from "../hostInterface";

function findActor(host: WebGLOsrsRendererHost, key: string) {
    return host.osrsClient.clientPlugins.cosmeticNpcs().find(actor => actor.key === key);
}

export function resolveCosmeticNpcHighlightTarget(host: WebGLOsrsRendererHost, key: string): CosmeticNpcHighlightTarget | undefined {
    const actor = findActor(host, key);
    return actor ? { kind: "cosmetic-npc", key, plane: actor.plane } : undefined;
}

export function isCosmeticNpcHighlightTargetStillPresent(host: WebGLOsrsRendererHost, target: CosmeticNpcHighlightTarget): boolean {
    const actor = findActor(host, target.key);
    return !!actor && actor.plane === target.plane;
}

/** Only the selected cosmetic model is expanded for the existing highlight overlay. No ECS lookup. */
export function buildCosmeticNpcModelHighlightTriangles(host: WebGLOsrsRendererHost, target: CosmeticNpcHighlightTarget) {
    const actor = findActor(host, target.key);
    if (!actor || actor.plane !== target.plane) return undefined;
    const type = host.osrsClient.npcTypeLoader.load(actor.typeId);
    const loader = host.getInteractNpcModelLoader();
    if (!type || !loader) return undefined;
    const model = (actor.seqId >= 0 ? loader.getModel(type, actor.seqId, actor.frameId) : undefined)
        ?? loader.getModel(type, -1, -1);
    if (!model) return undefined;
    const x = Math.round(actor.x * 128) / 128, z = Math.round(actor.y * 128) / 128;
    const height = sampleActorHeightForWorldTile(host.mapManager, x, z, actor.plane);
    if (!height.valid) return undefined;
    const y = height.height + RENDER_CONSTANTS.ACTOR_GROUND_CLEARANCE_MODEL_UNITS / 128;
    const angle = actor.rotation * RS_TO_RADIANS, cos = Math.cos(angle), sin = Math.sin(angle);
    return host.buildModelTrianglePoints(model, i => ({
        x: x + (model.verticesX[i] * cos + model.verticesZ[i] * sin) / 128,
        y: y + model.verticesY[i] / 128,
        z: z + (-model.verticesX[i] * sin + model.verticesZ[i] * cos) / 128,
    }));
}
