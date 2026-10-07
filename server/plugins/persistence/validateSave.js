/**
 * Checks a serialized player save before it is written: valid JSON with a position, a 28-slot
 * inventory, 14 equipment slots and a full set of skills. Used by the SQLite save writer
 * (SqliteSaveWorker.js), which has no access to the game's classes, hence `skillCount`.
 */
function validateSerializedSave(serialized, username, skillCount) {
  let parsed;
  try {
    parsed = JSON.parse(serialized);
  } catch (error) {
    throw new Error(
      `Refusing to save invalid JSON for ${username}: ${error?.message ?? error}`
    );
  }

  const assertFiniteNumber = (value, pathLabel) => {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new Error(
        `Refusing to save ${username}: ${pathLabel} must be a finite number`
      );
    }
  };

  const assertObject = (value, pathLabel) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`Refusing to save ${username}: ${pathLabel} must be an object`);
    }
  };

  const assertItemArray = (value, expectedLength, pathLabel) => {
    if (!Array.isArray(value) || value.length !== expectedLength) {
      throw new Error(
        `Refusing to save ${username}: ${pathLabel} must be an array of length ${expectedLength}`
      );
    }
    for (let i = 0; i < value.length; i++) {
      const entry = value[i];
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        throw new Error(
          `Refusing to save ${username}: ${pathLabel}[${i}] must be an object`
        );
      }
      assertFiniteNumber(entry.id, `${pathLabel}[${i}].id`);
      assertFiniteNumber(entry.amount, `${pathLabel}[${i}].amount`);
    }
  };

  const assertNumericArray = (value, expectedLength, pathLabel) => {
    if (!Array.isArray(value) || value.length !== expectedLength) {
      throw new Error(
        `Refusing to save ${username}: ${pathLabel} must be an array of length ${expectedLength}`
      );
    }
    for (let i = 0; i < value.length; i++) {
      assertFiniteNumber(value[i], `${pathLabel}[${i}]`);
    }
  };

  assertObject(parsed, "root");
  assertObject(parsed.position, "position");
  assertFiniteNumber(parsed.position.x, "position.x");
  assertFiniteNumber(parsed.position.y, "position.y");
  assertFiniteNumber(parsed.position.z, "position.z");

  assertItemArray(parsed.inventory, 28, "inventory");
  assertItemArray(parsed.equipment, 14, "equipment");

  assertObject(parsed.skills, "skills");
  assertNumericArray(parsed.skills.level, skillCount, "skills.level");
  assertNumericArray(parsed.skills.maxLevel, skillCount, "skills.maxLevel");
  assertNumericArray(
    parsed.skills.experience,
    skillCount,
    "skills.experience"
  );
}

module.exports = { validateSerializedSave };
