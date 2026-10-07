import { FloatUtil } from "../../common/utils/FloatUtil";
import { clamp } from "../../common/utils/MathUtil";
import { DataBuffer } from "../../game/buffer/DataBuffer";

export class VertexBuffer extends DataBuffer {
    static readonly STRIDE = 12;

    // The complete packed vertex is the cache identity. A numeric hash based
    // on multiplying its fields loses precision in JavaScript and can merge
    // unrelated vertices, creating stray stretched triangles in the scene.
    vertexIndices: Map<string, number>;

    constructor(count: number, stride: number = VertexBuffer.STRIDE) {
        super(stride, count);
        this.vertexIndices = new Map();
    }

    // Compress OSRS face priorities (typically 0..11) into 3 bits (0..7)
    // while preserving useful ordering bands. Collapses 4..7 into two bands
    // and 8..11 into the top two bands so overlays remain clearly above base.
    private static compressPriority(p: number): number {
        if (p < 0) return 0;
        if (p <= 3) return p; // 0..3 -> 0..3
        if (p <= 7) return 4 + ((p - 4) >> 1); // 4..5 -> 4, 6..7 -> 5
        return 6 + ((p - 8) >> 1); // 8..9 -> 6, 10..11 -> 7
    }

    addVertex(
        x: number,
        y: number,
        z: number,
        hsl: number,
        alpha: number,
        u: number,
        v: number,
        textureId: number,
        reuseVertex: boolean = true,
        priority: number = 0,
        priorityIsPacked: boolean = false,
        actorData: number = 0,
    ) {
        if (textureId >= 1024) {
            textureId = -1;
        }
        const isTextured = textureId !== -1;
        if (isTextured) {
            // textureId = 119;
            // only light
            hsl &= 127;
            hsl |= (textureId & 0x1ff) << 7;
        }

        const xPos = clamp(x + 0x4000, 0, 0x8000);
        const yPos = clamp(-y + 0x4000, 0, 0x8000);
        const zPos = clamp(z + 0x4000, 0, 0x8000);

        const uPacked = clamp(FloatUtil.packFloat11(u), 0, 0x7ff);
        const vPacked = clamp(FloatUtil.packFloat11(v), 0, 0x7ff);

        const v0 = (xPos << 17) | ((uPacked & 0x3f) << 11) | vPacked;

        const v1 = yPos | (hsl << 15) | (Number(isTextured) << 31);

        // Pack per-face priority (0-7, 3 bits) into bits [8:6] (previously unused)
        // Keep uPacked high bits at [4:0] and textureId bit at [5]
        const packedPriority = priorityIsPacked
            ? clamp(priority, 0, 7)
            : VertexBuffer.compressPriority(priority);
        const v2 =
            (zPos << 17) |
            (alpha << 9) |
            ((packedPriority & 0x7) << 6) |
            (((textureId >> 9) & 0x1) << 5) |
            (uPacked >> 6);

        if (reuseVertex) {
            const key = `${v0 >>> 0}:${v1 >>> 0}:${v2 >>> 0}` + (this.stride > VertexBuffer.STRIDE ? `:${actorData >>> 0}` : "");
            const cachedIndex = this.vertexIndices.get(key);
            if (cachedIndex !== undefined) {
                return cachedIndex;
            } else {
                this.vertexIndices.set(key, this.offset);
            }
        }
        this.ensureSize(1);
        const byteOffset = this.byteOffset();

        this.view.setUint32(byteOffset, v0, true);
        this.view.setUint32(byteOffset + 4, v1, true);
        this.view.setUint32(byteOffset + 8, v2, true);
        if (this.stride > VertexBuffer.STRIDE) this.view.setUint32(byteOffset + 12, actorData, true);

        return this.offset++;
    }
}
