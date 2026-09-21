/**
 * owner-проверка для system_update: только config.ownerUserId / GRISHA_OWNER_ID.
 */
import { loadConfig } from "@griha/config";
import { resolveOwnerId } from "../UsersService.js";

export function isOwnerUserId(userId: string | number | undefined): boolean {
  if (userId === undefined || userId === null) return false;
  const ownerId = resolveOwnerId(loadConfig());
  if (!ownerId) return false;
  return String(userId) === String(ownerId);
}
