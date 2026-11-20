import { USER_ROLES, type UserRole } from "./auth/types";

export const ROLES = USER_ROLES;
export type Role = UserRole;

export function isRole(value: string | undefined): value is Role {
  return value === "user" || value === "admin";
}
