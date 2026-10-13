export class NetworkConstants {
    public static readonly TCP_PORT: number = parseInt(process.env.TCP_PORT || "43594", 10) || 0;
    public static readonly WEBSOCKET_PORT: number = parseInt(process.env.WEBSOCKET_PORT || "43594", 10) || 0;
    public static readonly LOGIN_REQUEST_OPCODE: number = 14;
    public static readonly NEW_CONNECTION_OPCODE: number = 16;
    public static readonly RECONNECTION_OPCODE: number = 18;
    public static readonly SESSION_TIMEOUT: number = 15;
    public static readonly RSA_MODULUS: bigint = BigInt("131409501542646890473421187351592645202876910715283031445708554322032707707649791604685616593680318619733794036379235220188001221437267862925531863675607742394687835827374685954437825783807190283337943749605737918856262761566146702087468587898515768996741636870321689974105378482179138088453912399137944888201");
    public static readonly RSA_EXPONENT: bigint = BigInt("79304472214370922762932105237390187381463672363705375233978043425709379778525976284494572865658334707555904114207777777341892920168231399767577257735843278036440634354404060637137311110371217284157987350293683059890663583033195388794460636931915044283757261183264988297579912358758185856341914846035938600173");
    public static readonly CONNECTION_LIMIT: number = 2;
    public static readonly SESSION_KEY: string = "session.key";
    public static readonly PACKET_PROCESS_LIMIT: number = 30;
    // Allow short bursts to spill across ticks without executing gameplay on the socket callback.
    public static readonly PACKET_QUEUE_LIMIT: number = 240;
    // WebSocket backpressure guardrails. These keep slow clients from making the
    // single Node event loop spend every tick building and flushing stale updates.
    public static readonly OUTBOUND_WS_BUFFER_HIGH_WATER_BYTES: number = parseInt(process.env.OUTBOUND_WS_BUFFER_HIGH_WATER_BYTES || "1048576", 10) || 1048576;
    public static readonly OUTBOUND_WS_BUFFER_CRITICAL_BYTES: number = parseInt(process.env.OUTBOUND_WS_BUFFER_CRITICAL_BYTES || "4194304", 10) || 4194304;
    public static readonly OUTBOUND_WS_QUEUE_HIGH_WATER_BYTES: number = parseInt(process.env.OUTBOUND_WS_QUEUE_HIGH_WATER_BYTES || "524288", 10) || 524288;
    public static readonly OUTBOUND_WS_QUEUE_MAX_FRAMES: number = parseInt(process.env.OUTBOUND_WS_QUEUE_MAX_FRAMES || "512", 10) || 512;
    public static readonly OUTBOUND_WS_MAX_FRAMES_PER_FLUSH: number = parseInt(process.env.OUTBOUND_WS_MAX_FRAMES_PER_FLUSH || "256", 10) || 256;
}
