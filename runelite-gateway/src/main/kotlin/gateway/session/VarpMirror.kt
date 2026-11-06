package gateway.session

import gateway.cache.VarTypes
import net.rsprot.protocol.game.outgoing.varp.VarpLarge
import net.rsprot.protocol.game.outgoing.varp.VarpSmall
import net.rsprot.protocol.message.OutgoingGameMessage

/**
 * The session's copy of every varp. tsps sends varbits on their own, which OSRS can't carry,
 * so a varbit change is written into its varp here and the whole varp goes to the client.
 */
class VarpMirror(private val types: VarTypes) {
    private val varps = HashMap<Int, Int>()

    operator fun get(varp: Int): Int = varps[varp] ?: 0

    /** The varp message for setting [varp], or null for an id the client has no room for. */
    fun setVarp(varp: Int, value: Int): OutgoingGameMessage? {
        if (varp !in 0 until types.varpCount) return null
        varps[varp] = value
        return message(varp, value)
    }

    fun setVarbit(varbit: Int, value: Int): OutgoingGameMessage? {
        val type = types.varbit(varbit) ?: return null
        val mask = type.mask
        // tsps writes 0 for a value that doesn't fit the varbit's bits.
        val bits = if (mask != -1 && (value < 0 || value > mask)) 0 else value
        val current = this[type.varp]
        val updated = (current and (mask shl type.lsb).inv()) or ((bits and mask) shl type.lsb)
        return setVarp(type.varp, updated)
    }

    fun getVarbit(varbit: Int): Int {
        val type = types.varbit(varbit) ?: return 0
        return (this[type.varp] ushr type.lsb) and type.mask
    }

    private fun message(varp: Int, value: Int): OutgoingGameMessage =
        if (value in Byte.MIN_VALUE..Byte.MAX_VALUE) VarpSmall(varp, value) else VarpLarge(varp, value)
}
