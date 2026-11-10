/**
 * Bridge between the frontend's department codes and the database's
 * department names.
 *
 *   frontend 'crops'     ↔  departments 'Crop Production'
 *   frontend 'livestock' ↔  departments 'Animal Rearing'
 *
 * Departments 3–5 (Stores, Sales, Administration) exist in the DB but
 * cannot be chosen at signup yet; they map to null for now.
 */
const CODE_TO_NAME = {
  crops: 'Crop Production',
  livestock: 'Animal Rearing',
};

const NAME_TO_CODE = Object.fromEntries(
  Object.entries(CODE_TO_NAME).map(([code, name]) => [name, code]),
);

/** 'crops' → 'Crop Production' (null for unknown codes). */
function departmentName(code) {
  return CODE_TO_NAME[code] ?? null;
}

/** 'Crop Production' → 'crops' (null for unknown names). */
function departmentCode(name) {
  return name ? (NAME_TO_CODE[name] ?? null) : null;
}

module.exports = { departmentName, departmentCode, CODE_TO_NAME };
