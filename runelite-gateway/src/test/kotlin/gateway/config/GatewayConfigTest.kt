package gateway.config

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Files
import java.nio.file.Path

class GatewayConfigTest {
    @Test
    fun `folder rename preserves an existing login key and prefers the new location`(@TempDir root: Path) {
        Files.createDirectories(root.resolve("server"))
        Files.writeString(root.resolve("server/target.txt"), "osrs-241_2026-10-20")
        val key = root.resolve("runelite-gateway/keys/rsa.txt")
        val legacyKey = root.resolve("gateway/keys/rsa.txt")
        assertEquals(key, GatewayConfig.load(root).keyFile)

        Files.createDirectories(legacyKey.parent)
        Files.writeString(legacyKey, "existing login key")
        assertEquals(legacyKey, GatewayConfig.load(root).keyFile)

        Files.createDirectories(key.parent)
        Files.writeString(key, "migrated login key")
        assertEquals(key, GatewayConfig.load(root).keyFile)
        assertEquals("existing login key", Files.readString(legacyKey))
    }
}
