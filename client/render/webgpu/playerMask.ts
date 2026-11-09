/**
 * The Shader Effects prayer aura's player silhouette: a frame-sized r8 target the controlled
 * player's posed model is drawn into (WebGPUActors.drawPlayerMask), 1 where the model covers a
 * pixel. The aura shader reads it so the glow follows the real model, animation and equipment
 * included, not a generic figure.
 */
import { GPU_TEXTURE_USAGE } from "./bindings";

export class PlayerMaskTarget {
    private texture?: GPUTexture;
    private view?: GPUTextureView;

    constructor(private readonly device: GPUDevice) {}

    /** The target's view, recreated when the frame size changes. */
    ensure(width: number, height: number): GPUTextureView {
        if (!this.texture || this.texture.width !== width || this.texture.height !== height) {
            this.texture?.destroy();
            this.texture = this.device.createTexture({
                label: "shaderfx player mask",
                size: [width, height],
                format: "r8unorm",
                usage: GPU_TEXTURE_USAGE.RENDER_ATTACHMENT | GPU_TEXTURE_USAGE.TEXTURE_BINDING,
            });
            this.view = this.texture.createView();
        }
        return this.view!;
    }

    dispose(): void {
        this.texture?.destroy();
        this.texture = undefined;
        this.view = undefined;
    }
}
