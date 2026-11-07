package gateway.session

import gateway.down.TspsHandshake
import net.rsprot.protocol.game.outgoing.info.playerinfo.PlayerAvatarExtendedInfo

/** Writes the appearance tsps sends with HANDSHAKE onto a player avatar. */
object Appearance {
    private const val MALE = 0

    fun apply(info: PlayerAvatarExtendedInfo, handshake: TspsHandshake) {
        info.setName(handshake.name)
        val appearance = handshake.appearance ?: return
        info.setMale(appearance.gender == MALE)
        // tsps's kit order (head, jaw, torso, arms, hands, legs, feet) and colour order (hair,
        // torso, legs, feet, skin) are OSRS's identkit and colour slots.
        appearance.kits.forEachIndexed { slot, kit -> if (slot < IDENT_KIT_SLOTS) info.setIdentKit(slot, kit) }
        appearance.colours.forEachIndexed { slot, colour -> if (slot < COLOUR_SLOTS) info.setColour(slot, colour) }
    }

    private const val IDENT_KIT_SLOTS = 7
    private const val COLOUR_SLOTS = 5
}
