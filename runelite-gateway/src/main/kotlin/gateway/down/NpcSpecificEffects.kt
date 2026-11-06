package gateway.down

import gateway.tsps.TspsPacket
import gateway.tsps.TspsServerPacket
import net.rsprot.protocol.game.outgoing.specific.NpcAnimSpecific
import net.rsprot.protocol.game.outgoing.specific.NpcSpotAnimSpecific
import net.rsprot.protocol.game.outgoing.worldentity.SetActiveWorldV2
import net.rsprot.protocol.message.OutgoingGameMessage

/** One observer's transient NPC effects, sent after its NPC info rather than changing an avatar. */
class NpcSpecificEffects(
    private val npcIndex: (Int) -> Int?,
    private val send: (OutgoingGameMessage) -> Unit,
    private val flush: () -> Unit,
    /** A deck's active world and the root world to restore; null for a root NPC. */
    private val worlds: (Int) -> Pair<SetActiveWorldV2, SetActiveWorldV2>? = { null },
) {
    fun handle(packet: TspsPacket): Boolean {
        if (packet.opcode != TspsServerPacket.NPC_ANIM_SPECIFIC && packet.opcode != TspsServerPacket.NPC_SPOTANIM_SPECIFIC) return false
        val reader = packet.reader()
        val index = reader.u16()
        // The server normally filters these. Never save an unknown target for a future spawn.
        val nativeIndex = npcIndex(index) ?: return true
        val id = reader.u16() // 65535 is the native reset sentinel, including spot slot clears.
        val message = when (packet.opcode) {
            TspsServerPacket.NPC_ANIM_SPECIFIC -> NpcAnimSpecific(nativeIndex, id, reader.u8())
            else -> NpcSpotAnimSpecific(nativeIndex, id, reader.u8(), reader.u16(), reader.u16())
        }
        val world = worlds(index)
        world?.let { send(it.first) }
        send(message)
        world?.let { send(it.second) }
        // NPC_INFO already flushed this tick; waiting for the next one would delay the effect.
        flush()
        return true
    }
}
