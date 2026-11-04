import { GPU_TEXTURE_USAGE } from "./bindings";

/**
 * A copy of the world as the canvas showed it, put back while the player's square builds
 * (SceneFrameHold). The WebGPU world pass draws straight into the canvas, which keeps nothing from
 * one frame to the next, so the scene is copied out every few frames while its square is ready; a
 * copy a few frames old looks the same as the last one when a teleport starts.
 */
export class WebGPUHeldScene {
    static readonly SNAPSHOT_INTERVAL_FRAMES = 8;

    private texture?: GPUTexture;
    private valid = false;

    constructor(private readonly device: GPUDevice) {}

    /** Whether a copy of this size and format is held. */
    isValidFor(canvas: GPUTexture): boolean {
        const t = this.texture;
        return (
            this.valid &&
            t !== undefined &&
            t.width === canvas.width &&
            t.height === canvas.height &&
            t.format === canvas.format
        );
    }

    /** Copies the world out of the canvas, every few frames or when no copy fits. */
    maybeSnapshot(encoder: GPUCommandEncoder, canvas: GPUTexture, frameCount: number): void {
        if (this.isValidFor(canvas) && frameCount % WebGPUHeldScene.SNAPSHOT_INTERVAL_FRAMES !== 0) return;
        const t = this.texture;
        if (!t || t.width !== canvas.width || t.height !== canvas.height || t.format !== canvas.format) {
            t?.destroy();
            this.texture = this.device.createTexture({
                label: "held-scene",
                size: [canvas.width, canvas.height],
                format: canvas.format,
                usage: GPU_TEXTURE_USAGE.COPY_SRC | GPU_TEXTURE_USAGE.COPY_DST,
            });
        }
        encoder.copyTextureToTexture(
            { texture: canvas },
            { texture: this.texture! },
            [canvas.width, canvas.height],
        );
        this.valid = true;
    }

    /** Puts the held world into the canvas, for the interface to be drawn over. */
    present(encoder: GPUCommandEncoder, canvas: GPUTexture): void {
        encoder.copyTextureToTexture(
            { texture: this.texture! },
            { texture: canvas },
            [canvas.width, canvas.height],
        );
    }

    invalidate(): void {
        this.valid = false;
    }

    destroy(): void {
        this.texture?.destroy();
        this.texture = undefined;
        this.valid = false;
    }
}
