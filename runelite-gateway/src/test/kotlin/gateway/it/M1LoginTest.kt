package gateway.it

import gateway.cache.DiskStore
import gateway.headless.TestCache
import net.rsprox.protocol.game.outgoing.model.info.playerinfo.PlayerInfo
import net.rsprox.protocol.game.outgoing.model.interfaces.IfOpenTop
import net.rsprox.protocol.game.outgoing.model.map.RebuildLoginV2
import net.rsprox.protocol.game.outgoing.model.misc.client.ServerTickEnd
import org.junit.jupiter.api.Assertions.assertArrayEquals
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.util.zip.CRC32

/** M1: JS5 from the tsps cache, the login bridge and the first frame. */
class M1LoginTest {
    private val gateway = LiveGateway.gateway
    private val modulus = gateway.rsa.modulus

    @Test
    fun `js5 serves the master index and groups with their index crcs`() {
        val client = LiveGateway.client()
        assertArrayEquals(TestCache.cache.masterIndex(), client.js5(DiskStore.MASTER_ARCHIVE, DiskStore.MASTER_ARCHIVE))
        val group = TestCache.cache.table(CONFIG_ARCHIVE).groups.getValue(VARBIT_GROUP)
        val container = client.js5(CONFIG_ARCHIVE, VARBIT_GROUP)
        assertEquals(group.crc, CRC32().apply { update(container) }.value.toInt())
    }

    @Test
    fun `a wrong password is refused with code 3`() {
        val name = LiveGateway.newAccount("gwpw")
        LiveGateway.client().login(name, PASSWORD, modulus).game!!.close()
        Thread.sleep(LOGOUT_SETTLE_MS)
        assertEquals(INVALID_USERNAME_OR_PASSWORD, LiveGateway.client().login(name, "wrong$PASSWORD", modulus).code)
    }

    @Test
    fun `a second login of an online account is refused with code 5`() {
        val name = LiveGateway.newAccount("gwdup")
        LiveGateway.client().login(name, PASSWORD, modulus).game!!.use {
            it.expect<RebuildLoginV2>()
            assertEquals(DUPLICATE, LiveGateway.client().login(name, PASSWORD, modulus).code)
        }
    }

    @Test
    fun `login sends rebuild, toplevel and a player info for the logged-in tile`() {
        val result = LiveGateway.client().login(LiveGateway.newAccount("gwm1"), PASSWORD, modulus)
        assertEquals(OK, result.code)
        result.game!!.use { game ->
            val rebuild = game.expect<RebuildLoginV2>()
            val tile = rebuild.playerInfoInitBlock.localPlayerCoord
            assertEquals(game.index, rebuild.playerInfoInitBlock.localPlayerIndex)
            // tsps's spawn tile, and the map built around it.
            assertTrue(tile.x > 0 && tile.z > 0, "logged in at ${tile.x}, ${tile.z}")
            assertEquals(tile.x ushr 3, rebuild.zoneX)
            assertEquals(tile.z ushr 3, rebuild.zoneZ)
            game.expect<IfOpenTop>()
            game.expect<PlayerInfo>()
            game.expect<ServerTickEnd>()
            // Ticks keep coming: tsps drives the gateway's clock.
            game.expect<ServerTickEnd>()
        }
    }

    @Test
    fun `logout gives the native client time to process Logout before disconnecting`() {
        val name = LiveGateway.newAccount("gwlo")
        LiveGateway.login(name).use { game ->
            game.expect<ServerTickEnd>()
            game.button(182, 8)
            game.expect<net.rsprox.protocol.game.outgoing.model.logout.Logout>()
            // Leave time to process Logout before EOF can trigger the connection-lost path.
            assertFalse(game.disconnectsWithin(NATIVE_LOGOUT_PROCESSING_MS))
            assertTrue(game.disconnectsWithin(LOGOUT_SETTLE_MS.toInt()))
        }
    }

    private companion object {
        const val CONFIG_ARCHIVE = 2
        const val VARBIT_GROUP = 14
        const val PASSWORD = "gateway-test"
        const val OK = 2
        const val INVALID_USERNAME_OR_PASSWORD = 3
        const val DUPLICATE = 5
        const val LOGOUT_SETTLE_MS = 2_000L
        const val NATIVE_LOGOUT_PROCESSING_MS = 50
    }
}
