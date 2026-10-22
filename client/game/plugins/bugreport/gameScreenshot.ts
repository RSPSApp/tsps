import { bytesToBase64 } from "./BugReportUpload";

const MAX_WIDTH = 1600;
const MAX_HEIGHT = 1200;
/** A JPEG over this is encoded again at a lower quality. */
const MAX_SCREENSHOT_BYTES = 900_000;
const QUALITIES = [0.85, 0.6];

/**
 * The game as the player sees it, scaled to fit 1600 × 1200: the scene canvas with every canvas
 * stacked over it (the widget overlay draws the interface on its own canvas). Call it straight
 * after a frame is drawn: a WebGL canvas is only readable until the browser presents it.
 */
export function composeGameFrame(scene: HTMLCanvasElement): HTMLCanvasElement | undefined {
    const { width, height } = scene;
    if (!width || !height) return undefined;
    const scale = Math.min(1, MAX_WIDTH / width, MAX_HEIGHT / height);
    const frame = document.createElement("canvas");
    frame.width = Math.max(1, Math.round(width * scale));
    frame.height = Math.max(1, Math.round(height * scale));
    const context = frame.getContext("2d");
    if (!context) return undefined;
    context.fillStyle = "#000";
    context.fillRect(0, 0, frame.width, frame.height);
    const layers = scene.parentElement
        ? Array.from(scene.parentElement.children).filter(
            (element): element is HTMLCanvasElement => element instanceof HTMLCanvasElement,
        )
        : [scene];
    for (const layer of layers) {
        if (layer.style.display === "none" || !layer.width || !layer.height) continue;
        context.drawImage(layer, 0, 0, frame.width, frame.height);
    }
    return frame;
}

/** A JPEG data URL of `frame`, re-encoded at a lower quality when it's large. */
export async function encodeScreenshot(frame: HTMLCanvasElement): Promise<string | undefined> {
    for (const quality of QUALITIES) {
        const blob = await new Promise<Blob | null>((resolve) => frame.toBlob(resolve, "image/jpeg", quality));
        if (!blob) return undefined;
        if (blob.size > MAX_SCREENSHOT_BYTES && quality !== QUALITIES[QUALITIES.length - 1]) continue;
        return `data:image/jpeg;base64,${bytesToBase64(new Uint8Array(await blob.arrayBuffer()))}`;
    }
    return undefined;
}
