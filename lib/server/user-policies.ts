import type { User } from "../types";

export function isUserActive(user: User): boolean {
  return user.active !== false;
}

export function sessionVersionMatches(
  storedVersion: number,
  cookieVersion?: number,
): boolean {
  return (cookieVersion ?? 1) === storedVersion;
}

export function permissionsChanged(previous: User, next: User): boolean {
  return (
    previous.role !== next.role ||
    isUserActive(previous) !== isUserActive(next) ||
    [...previous.hotelIds].sort().join("\0") !==
      [...next.hotelIds].sort().join("\0")
  );
}
