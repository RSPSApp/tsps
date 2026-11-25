import { inflate } from "pako";

/**
 * Synchronous decode of an 8-bit RGB, non-interlaced PNG: the format of every world map ground
 * sprite (64x64, cache rev 241). Returns 0xRRGGBB per pixel, or undefined for any other PNG so
 * the caller can fall back to the browser's decoder.
 *
 * Ours: the browser decode (createImageBitmap) is asynchronous and in Chrome took ~200ms per
 * sprite, most of a cold square's render time; this one takes well under a millisecond.
 */
export function decodeRgbPng(bytes: Uint8Array): { width: number; height: number; rgb: Int32Array } | undefined {
    if (
        bytes.length < 33 ||
        bytes[0] !== 0x89 ||
        bytes[1] !== 0x50 ||
        bytes[2] !== 0x4e ||
        bytes[3] !== 0x47
    ) {
        return undefined;
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let width = 0;
    let height = 0;
    const idat: Uint8Array[] = [];
    let idatLength = 0;
    for (let offset = 8; offset + 8 <= bytes.length; ) {
        const length = view.getUint32(offset);
        const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
        const data = offset + 8;
        if (data + length > bytes.length) return undefined;
        if (type === "IHDR") {
            width = view.getUint32(data);
            height = view.getUint32(data + 4);
            const bitDepth = bytes[data + 8];
            const colorType = bytes[data + 9];
            const interlace = bytes[data + 12];
            if (bitDepth !== 8 || colorType !== 2 || interlace !== 0) return undefined;
            if (width <= 0 || height <= 0 || width > 4096 || height > 4096) return undefined;
        } else if (type === "IDAT") {
            idat.push(bytes.subarray(data, data + length));
            idatLength += length;
        } else if (type === "IEND") {
            break;
        }
        offset = data + length + 4;
    }
    if (width === 0 || idat.length === 0) return undefined;
    const compressed = idat.length === 1 ? idat[0] : new Uint8Array(idatLength);
    if (idat.length > 1) {
        let at = 0;
        for (const part of idat) {
            compressed.set(part, at);
            at += part.length;
        }
    }
    let raw: Uint8Array;
    try {
        raw = inflate(compressed);
    } catch {
        return undefined;
    }
    const stride = width * 3;
    if (raw.length < (stride + 1) * height) return undefined;
    // Undo each scanline's filter in place (PNG spec, section 9), 3 bytes per pixel.
    const line = new Uint8Array(stride);
    const previous = new Uint8Array(stride);
    const rgb = new Int32Array(width * height);
    for (let y = 0; y < height; y++) {
        const filter = raw[y * (stride + 1)];
        const src = y * (stride + 1) + 1;
        for (let i = 0; i < stride; i++) {
            const x = raw[src + i];
            const a = i >= 3 ? line[i - 3] : 0;
            const b = previous[i];
            const c = i >= 3 ? previous[i - 3] : 0;
            let value: number;
            switch (filter) {
                case 0:
                    value = x;
                    break;
                case 1:
                    value = x + a;
                    break;
                case 2:
                    value = x + b;
                    break;
                case 3:
                    value = x + ((a + b) >> 1);
                    break;
                case 4: {
                    const p = a + b - c;
                    const pa = Math.abs(p - a);
                    const pb = Math.abs(p - b);
                    const pc = Math.abs(p - c);
                    value = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
                    break;
                }
                default:
                    return undefined;
            }
            line[i] = value & 0xff;
        }
        for (let x = 0, i = 0; x < width; x++, i += 3) {
            rgb[y * width + x] = (line[i] << 16) | (line[i + 1] << 8) | line[i + 2];
        }
        previous.set(line);
    }
    return { width, height, rgb };
}
