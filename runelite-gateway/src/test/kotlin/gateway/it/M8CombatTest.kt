package gateway.it

import net.rsprox.protocol.game.outgoing.model.info.npcinfo.NpcInfo
import net.rsprox.protocol.game.outgoing.model.info.npcinfo.NpcUpdateType
import net.rsprox.protocol.game.outgoing.model.info.shared.extendedinfo.HeadbarExtendedInfo
import net.rsprox.protocol.game.outgoing.model.info.shared.extendedinfo.HitmarkExtendedInfo
import net.rsprox.protocol.game.outgoing.model.map.RebuildLoginV2
import net.rsprox.protocol.game.outgoing.model.misc.client.ServerTickEnd
import net.rsprox.protocol.game.outgoing.model.misc.player.MessageGame
import org.junit.jupiter.api.Assumptions.assumeTrue
import org.junit.jupiter.api.Test

/** M8: attacking an NPC shows hitsplats on it. */
class M8CombatTest {
    @Test
    fun `attacking a lumbridge npc puts hitsplats on it`() {
        val developer = LiveGateway.developerName
        assumeTrue(developer != null, "DEV_USERNAME isn't set; the test teleports to Lumbridge")
        LiveGateway.login(developer!!).use { game ->
            game.expect<RebuildLoginV2>()
            game.command("tele $X $Z 0")
            val rats = ArrayList<Int>()
            while (rats.isEmpty()) {
                game.expect<NpcInfo>().updates.forEach { (index, update) ->
                    if (update is NpcUpdateType.LowResolutionToHighResolution && update.id in ATTACKABLE) rats += index
                }
            }
            // tsps ignores clicks while the teleport still holds the player.
            var ticks = 0
            while (ticks < SETTLE_TICKS) if (game.next() is ServerTickEnd) ticks++
            val seen = ArrayList<String>()
            // Some rats are behind walls ("I can't reach that!"); try the next one.
            for (target in rats.take(MAX_TARGETS)) {
                game.npcOp2(target)
                if (game.hitWithin(target, seen)) return
            }
            error("no rat took a hit; saw: $seen")
        }
    }

    /** Whether [target] shows a hitsplat and health bar within the combat ticks; false if it can't be reached. */
    private fun gateway.headless.HeadlessClient.Game.hitWithin(target: Int, seen: MutableList<String>): Boolean {
        repeat(COMBAT_TICKS) {
            var npcs: NpcInfo? = null
            while (npcs == null) {
                when (val message = next() ?: error("stream ended")) {
                    is NpcInfo -> npcs = message
                    is MessageGame -> {
                        seen += "message: ${message.message}"
                        if (message.message.contains("can't reach")) return false
                    }
                }
            }
            val update = npcs.updates[target] ?: return@repeat
            val info = (update as? NpcUpdateType.Active)?.extendedInfo
            if (info == null) {
                seen += update.javaClass.simpleName
                return@repeat
            }
            seen += info.map { it.javaClass.simpleName }
            // A hit lands as a hitsplat and the health bar under it.
            if (info.any { it is HitmarkExtendedInfo } && info.any { it is HeadbarExtendedInfo }) return true
        }
        return false
    }

    private companion object {
        const val X = 3222
        const val Z = 3218
        const val COMBAT_TICKS = 60
        const val SETTLE_TICKS = 4
        const val MAX_TARGETS = 4

        /** The rats that spawn by Lumbridge castle (npc-spawns.json); Attack is their op 2. */
        val ATTACKABLE = setOf(2854)
    }
}
