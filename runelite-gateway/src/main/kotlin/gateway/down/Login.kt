package gateway.down

import gateway.tsps.TspsPacket
import net.rsprot.protocol.loginprot.outgoing.LoginResponse

/** `LOGIN_RESPONSE` (3): `u8 ok, i32 code, error, displayName, token`. */
class TspsLoginResult(val ok: Boolean, val code: Int, val error: String) {
    /** The OSRS response for a refused login. tsps's codes follow OSRS except where noted. */
    fun toLoginResponse(): LoginResponse =
        when (code) {
            3 -> LoginResponse.InvalidUsernameOrPassword
            4 -> LoginResponse.Banned
            5 -> LoginResponse.Duplicate
            6 -> LoginResponse.ClientOutOfDate
            // tsps sends 2 for a full world; 2 means success in OSRS.
            2 -> LoginResponse.ServerFull
            // tsps's IP ban; OSRS 27 is "service unavailable".
            27 -> LoginResponse.IPBlocked
            8 -> LoginResponse.LoginServerOffline
            else -> if (error.isNotEmpty()) disallowed(error) else LoginResponse.UnknownReplyFromLoginServer
        }

    companion object {
        fun decode(packet: TspsPacket): TspsLoginResult {
            val reader = packet.reader()
            return TspsLoginResult(reader.u8() != 0, reader.i32(), reader.string())
        }

        private fun disallowed(message: String) = LoginResponse.DisallowedByScript(message, "", "")
    }
}

/** `HANDSHAKE` (2): the player tsps created, sent once it is in the world. */
class TspsHandshake(
    val index: Int,
    val name: String,
    val appearance: Appearance?,
    val chatIcons: IntArray,
    val admin: Boolean,
    val members: Boolean,
) {
    class Appearance(val gender: Int, val colours: IntArray, val kits: IntArray, val equipment: IntArray)

    companion object {
        fun decode(packet: TspsPacket): TspsHandshake {
            val reader = packet.reader()
            val index = reader.i32()
            val name = reader.string()
            val appearance =
                if (reader.u8() == 0) {
                    null
                } else {
                    val gender = reader.u8()
                    val colours = IntArray(reader.u8()) { reader.u8() }
                    val kits = IntArray(reader.u8()) { reader.s16() }
                    val equipment = IntArray(reader.u8()) { reader.s16() }
                    Appearance(gender, colours, kits, equipment)
                }
            val icons = IntArray(reader.u8()) { reader.u8() }
            reader.string()
            val admin = reader.u8() != 0
            val members = reader.u8() != 0
            return TspsHandshake(index, name, appearance, icons, admin, members)
        }
    }
}
