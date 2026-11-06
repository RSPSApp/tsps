package gateway.it

import net.rsprox.protocol.game.outgoing.model.info.playerinfo.PlayerInfo
import net.rsprox.protocol.game.outgoing.model.info.playerinfo.PlayerUpdateType
import net.rsprox.protocol.game.outgoing.model.info.shared.extendedinfo.ExactMoveExtendedInfo
import net.rsprox.protocol.game.outgoing.model.map.RebuildLoginV2
import net.rsprox.protocol.game.outgoing.model.misc.client.ServerTickEnd
import net.rsprox.protocol.game.outgoing.model.misc.player.UpdateStatV2
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assumptions.assumeTrue
import org.junit.jupiter.api.Test

/** Forced movement (agility obstacles), as the official client needs it. */
class AgilityTest {
    @Test
    fun `the Varrock clothes line lands the player where tsps has them`() {
        val developer = LiveGateway.developerName
        assumeTrue(developer != null, "DEV_USERNAME isn't set; the test teleports onto the roof")
        LiveGateway.login(developer!!).use { game ->
            game.expect<RebuildLoginV2>()
            var agility = 0
            game.command("tele $START_X $Z $ROOF")
            game.ticks(SETTLE_TICKS) { if (it is UpdateStatV2 && it.stat == AGILITY) agility = it.currentLevel }
            if (agility < VARROCK_ROOFTOP_LEVEL) {
                game.command("setlevel agility $VARROCK_ROOFTOP_LEVEL")
                game.ticks(1)
            }
            game.opLoc1(CLOTHES_LINE, LINE_X, Z)
            // Each jump: the player is on its end tile as it starts, the move drawn from where they
            // were (OSRS's way); before, the tile never changed and the client drifted from tsps.
            val landings = ArrayList<Int>()
            var ticks = 0
            while (ticks < COURSE_TICKS) {
                when (val message = game.next() ?: error("stream ended")) {
                    is ServerTickEnd -> ticks++
                    is PlayerInfo -> {
                        val update = message.updates[game.index] as? PlayerUpdateType.HighResolutionMovement ?: continue
                        val move = update.extendedInfo.filterIsInstance<ExactMoveExtendedInfo>().singleOrNull() ?: continue
                        assertEquals(0 to 0, move.deltaX2 to move.deltaZ2, "the move ends on the player's tile")
                        landings += update.coord.x
                    }
                }
            }
            assertEquals(listOf(3212, 3210, 3208), landings)
        }
    }

    private fun gateway.headless.HeadlessClient.Game.ticks(count: Int, each: (Any) -> Unit = {}) {
        var seen = 0
        while (seen < count) {
            val message = next() ?: error("stream ended")
            each(message)
            if (message is ServerTickEnd) seen++
        }
    }

    private companion object {
        const val CLOTHES_LINE = 14413
        const val LINE_X = 3213
        const val START_X = 3214
        const val Z = 3414
        const val ROOF = 3
        const val SETTLE_TICKS = 4
        const val COURSE_TICKS = 12
        const val AGILITY = 16
        const val VARROCK_ROOFTOP_LEVEL = 30
    }
}
