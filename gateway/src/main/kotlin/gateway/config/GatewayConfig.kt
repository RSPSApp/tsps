package gateway.config

import java.nio.file.Files
import java.nio.file.Path

/**
 * Settings come from the repository's root `.env`, the same file `scripts/wt` writes each
 * worktree's ports into, so the gateway always pairs with this checkout's tsps server.
 * Process environment variables win over `.env`.
 */
data class GatewayConfig(
    val root: Path,
    val gatewayPort: Int,
    val websocketPort: Int,
    val cacheDirectory: Path,
    val keyFile: Path,
    /** The host players reach tsps and the gateway at (`PUBLIC_HOST`), as tsps's jav_config gives it. */
    val publicHost: String = DEFAULT_PUBLIC_HOST,
    /**
     * The address the game listener binds (`GATEWAY_BIND_HOST`): loopback by default, `0.0.0.0` (or
     * one interface's address) for players on other machines. PUBLIC_HOST is what they're told to
     * connect to, which behind NAT or a domain needn't be a local interface.
     */
    val bindHost: String = DEFAULT_BIND_HOST,
) {
    val tspsUrl: String get() = "ws://127.0.0.1:$websocketPort/"

    companion object {
        const val DEFAULT_GATEWAY_PORT = 43595
        const val DEFAULT_WEBSOCKET_PORT = 43594
        const val DEFAULT_PUBLIC_HOST = "127.0.0.1"
        const val DEFAULT_BIND_HOST = "127.0.0.1"

        fun load(root: Path = Path.of("").toAbsolutePath()): GatewayConfig {
            val env = readEnv(root.resolve(".env")) + System.getenv()
            val target = Files.readString(root.resolve("server/target.txt")).trim()
            return GatewayConfig(
                root = root,
                gatewayPort = env["GATEWAY_PORT"]?.toInt() ?: DEFAULT_GATEWAY_PORT,
                websocketPort = env["WEBSOCKET_PORT"]?.toInt() ?: DEFAULT_WEBSOCKET_PORT,
                cacheDirectory = root.resolve("server/caches").resolve(target),
                keyFile = root.resolve("gateway/keys/rsa.txt"),
                publicHost = env["PUBLIC_HOST"]?.takeIf { it.isNotBlank() } ?: DEFAULT_PUBLIC_HOST,
                bindHost = env["GATEWAY_BIND_HOST"]?.takeIf { it.isNotBlank() } ?: DEFAULT_BIND_HOST,
            )
        }

        private fun readEnv(file: Path): Map<String, String> {
            if (!Files.exists(file)) return emptyMap()
            return Files.readAllLines(file)
                .map { it.trim() }
                .filter { it.isNotEmpty() && !it.startsWith("#") && '=' in it }
                .associate { line -> line.substringBefore('=').trim() to line.substringAfter('=').trim().trim('"') }
        }
    }
}
