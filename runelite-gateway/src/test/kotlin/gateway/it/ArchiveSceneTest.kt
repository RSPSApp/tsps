package gateway.it

import net.rsprox.protocol.game.outgoing.model.info.playerinfo.PlayerInfo
import net.rsprox.protocol.game.outgoing.model.info.playerinfo.PlayerUpdateType
import net.rsprox.protocol.game.outgoing.model.map.RebuildLoginV2
import net.rsprox.protocol.game.outgoing.model.map.RebuildNormalV2
import net.rsprox.protocol.game.outgoing.model.misc.client.ServerTickEnd
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Assumptions.assumeTrue
import org.junit.jupiter.api.Test

/**
 * A private area on the real map (the Fractured Archive): tsps sends no rebuilds there, so the
 * gateway keeps the client's scene around the player itself.
 */
class ArchiveSceneTest {
    @Test
    fun `the scene follows the player through the Fractured Archive`() {
        val developer = LiveGateway.developerName
        assumeTrue(developer != null, "DEV_USERNAME isn't set; ::tfaguardian is a developer command")
        LiveGateway.login(developer!!).use { game ->
            val login = game.expect<RebuildLoginV2>()
            var scene = login.zoneX to login.zoneZ
            var rebuilds = 0
            var at: Pair<Int, Int>? = null
            game.command("tfaguardian")
            var ticks = 0
            while (ticks < TICKS) {
                when (val message = game.next() ?: error("stream ended")) {
                    is RebuildNormalV2 -> {
                        scene = message.zoneX to message.zoneZ
                        rebuilds++
                    }
                    is PlayerInfo -> {
                        val update = message.updates[game.index] as? PlayerUpdateType.HighResolutionMovement ?: continue
                        val tile = update.coord.x to update.coord.z
                        at = tile
                        val local = tile.first - ((scene.first - 6) shl 3) to tile.second - ((scene.second - 6) shl 3)
                        assertTrue(local.first in EDGE until 104 - EDGE && local.second in EDGE until 104 - EDGE, "$tile is at the edge of the scene around zone $scene")
                    }
                    is ServerTickEnd -> {
                        ticks++
                        if (ticks == ARRIVED) {
                            assertEquals(ARRIVAL, at, "::tfaguardian puts the player at the raid's arrival")
                            game.walk(ARRIVAL.first, FAR_Z)
                        }
                    }
                }
            }
            assertEquals(FAR_Z, at?.second, "the player ran to the far tile")
            assertTrue(rebuilds > 0, "the run north needs a new scene")
        }
    }

    private companion object {
        /** Tiles from the scene's edge the player is kept (tsps's PlayerSession rule). */
        const val EDGE = 16
        val ARRIVAL = 4127 to 5571
        const val FAR_Z = 5607
        const val ARRIVED = 8
        const val TICKS = 35
    }
}
