export type PluginMessagePayload = { channel: string; data: Record<string, unknown> };
// Mirrored by the server's ClientProtocol plugin-message codec.
export const MAX_PLUGIN_MESSAGE_BYTES = 16_384;

export function parsePluginMessage(bytes: Uint8Array): PluginMessagePayload {
    if (bytes.length > MAX_PLUGIN_MESSAGE_BYTES) throw new Error("Plugin message is too large");
    const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!value || typeof value.channel !== "string" || !/^[a-z][a-z0-9:-]{0,63}$/.test(value.channel)
        || !value.data || typeof value.data !== "object" || Array.isArray(value.data)) {
        throw new Error("Invalid plugin message");
    }
    return value;
}

export function encodePluginMessagePayload(value: PluginMessagePayload): Uint8Array {
    const bytes = new TextEncoder().encode(JSON.stringify(value));
    parsePluginMessage(bytes);
    return bytes;
}
