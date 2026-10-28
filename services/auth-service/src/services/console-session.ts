import { badRequest, forbidden, unauthorized } from "@fii/common";
export type ConsoleScope = "tenant" | "platform";
export function parseConsoleScope(value?: string): ConsoleScope | undefined {
  if (value === undefined) return undefined;
  if (value !== "tenant" && value !== "platform") throw badRequest("Invalid console scope");
  return value;
}
export function refreshCookieName(scope?: ConsoleScope) { return scope ? `fii_refresh_${scope}` : "fii_refresh"; }
export function assertConsoleSession(user: { id: string; userType: string; isPlatformAdmin: boolean }, scope?: ConsoleScope, expectedUserId?: string) {
  if (expectedUserId && user.id !== expectedUserId) throw unauthorized("Account session changed. Sign in again.");
  if (!scope) return;
  if (user.userType !== "STAFF" || (scope === "platform" ? !user.isPlatformAdmin : user.isPlatformAdmin)) {
    throw forbidden(`Sign in with the correct ${scope} console account`);
  }
}
