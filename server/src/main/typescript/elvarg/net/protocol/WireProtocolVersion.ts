/**
 * Explicit browser game wire contract. Mirrored by
 * client/network/serverConnection/protocolCompatibility.ts (checked by the protocol test).
 * Bump both versions only for incompatible wire changes, never for source/cache changes.
 * Servers without an announcement have unknown compatibility, not version 1.
 */
export const WIRE_PROTOCOL_VERSION = 1;
