// Decodes a SHOP_OPEN server packet (ClientProtocol.encodeShopOpen): opcode, 2-byte length, the shop
// id and name (latin1, 0-terminated), currency, general, buy/sell modes, the stock count and 20-byte
// slots, then the 2-byte inventory id (#5888) when the packet carries one. Reading from the front
// keeps tests working when fields are appended after the stock.
const SHOP_OPEN = 150;

function decodeShopOpen(packet) {
  const buf = Buffer.from(packet);
  if (buf[0] !== SHOP_OPEN) throw new Error(`not a SHOP_OPEN packet (opcode ${buf[0]})`);
  const end = 3 + buf.readUInt16BE(1);
  let at = 3;
  const string = () => {
    const stop = buf.indexOf(0, at);
    const value = buf.toString("latin1", at, stop);
    at = stop + 1;
    return value;
  };
  const id = string();
  const name = string();
  const currencyItemId = buf.readUInt16BE(at);
  const general = buf[at + 2] === 1;
  const buyMode = buf[at + 3];
  const sellMode = buf[at + 4];
  const count = buf.readUInt16BE(at + 5);
  at += 7;
  const stock = [];
  for (let index = 0; index < count; index++, at += 20) {
    stock.push({
      slot: buf.readUInt16BE(at),
      itemId: buf.readUInt16BE(at + 2),
      quantity: buf.readInt32BE(at + 4),
      defaultQuantity: buf.readInt32BE(at + 8),
      priceEach: buf.readInt32BE(at + 12),
      sellPrice: buf.readInt32BE(at + 16),
    });
  }
  const inventoryId = end - at >= 2 ? buf.readUInt16BE(at) : null;
  return { id, name, currencyItemId, general, buyMode, sellMode, stock, inventoryId };
}

module.exports = { SHOP_OPEN, decodeShopOpen };
