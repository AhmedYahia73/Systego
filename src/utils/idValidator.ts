import mongoose from "mongoose";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Validates whether an ID is a valid Customer ID.
 * Customers in the system use UUIDs (crypto.randomUUID) as their `_id`,
 * while legacy records may use MongoDB ObjectIds.
 */
export const isValidCustomerId = (id: unknown): boolean => {
  if (typeof id !== "string") return false;
  const trimmed = id.trim();
  if (!trimmed) return false;
  return UUID_REGEX.test(trimmed) || mongoose.Types.ObjectId.isValid(trimmed);
};
