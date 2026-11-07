package gateway.it

import gateway.headless.HeadlessClient
import net.rsprox.protocol.game.outgoing.model.info.npcinfo.NpcInfo
import net.rsprox.protocol.game.outgoing.model.info.npcinfo.NpcUpdateType
import net.rsprox.protocol.game.outgoing.model.info.playerinfo.PlayerInfo
import net.rsprox.protocol.game.outgoing.model.info.playerinfo.PlayerUpdateType
import net.rsprox.protocol.game.outgoing.model.info.playerinfo.extendedinfo.AppearanceExtendedInfo
import net.rsprox.protocol.game.outgoing.model.info.playerinfo.extendedinfo.ChatExtendedInfo
import net.rsprox.protocol.game.outgoing.model.info.shared.extendedinfo.ExtendedInfo
import net.rsprox.protocol.game.outgoing.model.map.RebuildLoginV2
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/** M3: other players with their appearance and chat, and NPCs. */
class M3EntitiesTest {
    private val modulus = LiveGateway.gateway.rsa.modulus

    @Test
    fun `players see each other's appearance and public chat`() {
        // New accounts start on the same tile, in the open world.
        val name = LiveGateway.newAccount("gwseen")
        login(name).use { other ->
            val spawn = other.expect<RebuildLoginV2>().playerInfoInitBlock.localPlayerCoord
            login(LiveGateway.newAccount("gwsees")).use { observer ->
                assertEquals(spawn, observer.expect<RebuildLoginV2>().playerInfoInitBlock.localPlayerCoord)

                val added = observer.playerUpdate(other.index) { it is PlayerUpdateType.LowResolutionToHighResolution }
                val appearance = added.extendedInfo().filterIsInstance<AppearanceExtendedInfo>().single()
                assertTrue(appearance.name.equals(name, ignoreCase = true), "seen as ${appearance.name}")

                other.say(CHAT)
                val chat = observer.playerUpdate(other.index) { update -> update.extendedInfo().any { it is ChatExtendedInfo } }
                assertEquals(CHAT, chat.extendedInfo().filterIsInstance<ChatExtendedInfo>().single().text.lowercase())
            }
        }
    }

    @Test
    fun `public chat keeps the colour and effect it was typed with`() {
        login(LiveGateway.newAccount("gwcol")).use { other ->
            other.expect<RebuildLoginV2>()
            login(LiveGateway.newAccount("gwcos")).use { observer ->
                observer.expect<RebuildLoginV2>()
                observer.playerUpdate(other.index) { it is PlayerUpdateType.LowResolutionToHighResolution }
                // "red:wave:" in the chatbox.
                other.say(CHAT, colour = RED, effect = WAVE)
                val chat =
                    observer.playerUpdate(other.index) { update -> update.extendedInfo().any { it is ChatExtendedInfo } }
                        .extendedInfo().filterIsInstance<ChatExtendedInfo>().single()
                assertEquals(RED to WAVE, chat.colour to chat.effects)
            }
        }
    }

    @Test
    fun `npcs around the spawn come into view`() {
        login(LiveGateway.newAccount("gwnpc")).use { game ->
            game.expect<RebuildLoginV2>()
            repeat(NPC_PACKETS) {
                val info = game.expect<NpcInfo>()
                val added = info.updates.values.filterIsInstance<NpcUpdateType.LowResolutionToHighResolution>()
                if (added.isNotEmpty()) {
                    assertTrue(added.all { it.id >= 0 })
                    return
                }
            }
            error("no NPC came into view")
        }
    }

    private fun login(name: String): HeadlessClient.Game {
        val result = LiveGateway.client().login(name, PASSWORD, modulus)
        assertEquals(OK, result.code, "login of $name")
        return result.game!!
    }

    private fun HeadlessClient.Game.playerUpdate(index: Int, matches: (PlayerUpdateType) -> Boolean): PlayerUpdateType {
        repeat(PLAYER_PACKETS) {
            val update = expect<PlayerInfo>().updates[index] ?: return@repeat
            if (matches(update)) return update
        }
        error("no matching update for player $index")
    }

    private fun PlayerUpdateType.extendedInfo(): List<ExtendedInfo> =
        when (this) {
            is PlayerUpdateType.LowResolutionToHighResolution -> extendedInfo
            is PlayerUpdateType.HighResolutionMovement -> extendedInfo
            is PlayerUpdateType.HighResolutionIdle -> extendedInfo
            else -> emptyList()
        }

    private companion object {
        const val RED = 1
        const val WAVE = 1
        const val PASSWORD = "gateway-test"
        const val OK = 2
        const val CHAT = "hello from the gateway"
        const val PLAYER_PACKETS = 40
        const val NPC_PACKETS = 20
    }
}
