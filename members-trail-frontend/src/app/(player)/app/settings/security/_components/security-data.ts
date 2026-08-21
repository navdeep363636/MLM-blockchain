/* D-03 · Invented-but-plausible session and login data.
 *
 * This lives next to the page rather than in src/lib/mock because the real
 * implementation reads it from the auth service's session store, not from the
 * platform ledger. Timestamps are fixed strings so server and client agree. */

export interface PlayerSession {
  id: string;
  device: string;
  browser: string;
  location: string;
  ip: string;
  lastActiveAt: string;
  createdAt: string;
  current: boolean;
  trusted: boolean;
}

export interface LoginEvent {
  id: string;
  at: string;
  ip: string;
  device: string;
  location: string;
  method: "password + TOTP" | "password + SMS" | "Google OAuth" | "Apple OAuth" | "password only";
  outcome: "success" | "failed" | "blocked";
  reason?: string;
}

export const sessions: PlayerSession[] = [
  {
    id: "SES-9f21",
    device: "Windows 11 desktop",
    browser: "Chrome 141",
    location: "Mohali, Punjab, IN",
    ip: "103.94.216.44",
    lastActiveAt: "2026-08-20T09:28:00Z",
    createdAt: "2026-08-18T06:02:00Z",
    current: true,
    trusted: true,
  },
  {
    id: "SES-4b07",
    device: "iPhone 16",
    browser: "Members Trail app 2.4.1",
    location: "Mohali, Punjab, IN",
    ip: "103.94.216.44",
    lastActiveAt: "2026-08-20T04:11:00Z",
    createdAt: "2026-06-30T17:44:00Z",
    current: false,
    trusted: true,
  },
  {
    id: "SES-71ce",
    device: "MacBook Air",
    browser: "Safari 19",
    location: "Bengaluru, Karnataka, IN",
    ip: "49.37.128.9",
    lastActiveAt: "2026-08-17T20:36:00Z",
    createdAt: "2026-08-17T20:12:00Z",
    current: false,
    trusted: false,
  },
  {
    id: "SES-2ad8",
    device: "Android 16 tablet",
    browser: "Chrome 140",
    location: "Dubai, AE",
    ip: "94.200.31.187",
    lastActiveAt: "2026-08-12T08:55:00Z",
    createdAt: "2026-08-12T08:49:00Z",
    current: false,
    trusted: false,
  },
];

export const loginHistory: LoginEvent[] = [
  { id: "LG-4401", at: "2026-08-20T09:02:00Z", ip: "103.94.216.44", device: "Chrome 141 · Windows 11", location: "Mohali, IN", method: "password + TOTP", outcome: "success" },
  { id: "LG-4400", at: "2026-08-20T04:10:00Z", ip: "103.94.216.44", device: "Members Trail app · iPhone 16", location: "Mohali, IN", method: "password + TOTP", outcome: "success" },
  { id: "LG-4399", at: "2026-08-19T22:41:00Z", ip: "45.118.202.77", device: "Chrome 139 · Windows 10", location: "Ho Chi Minh City, VN", method: "password only", outcome: "blocked", reason: "Impossible-travel rule · 2FA challenge not completed" },
  { id: "LG-4398", at: "2026-08-19T22:39:00Z", ip: "45.118.202.77", device: "Chrome 139 · Windows 10", location: "Ho Chi Minh City, VN", method: "password only", outcome: "failed", reason: "Incorrect password (attempt 3 of 5)" },
  { id: "LG-4397", at: "2026-08-19T10:15:00Z", ip: "103.94.216.44", device: "Chrome 141 · Windows 11", location: "Mohali, IN", method: "Google OAuth", outcome: "success" },
  { id: "LG-4396", at: "2026-08-18T06:02:00Z", ip: "103.94.216.44", device: "Chrome 141 · Windows 11", location: "Mohali, IN", method: "password + TOTP", outcome: "success" },
  { id: "LG-4395", at: "2026-08-17T20:12:00Z", ip: "49.37.128.9", device: "Safari 19 · macOS", location: "Bengaluru, IN", method: "password + SMS", outcome: "success" },
  { id: "LG-4394", at: "2026-08-17T20:08:00Z", ip: "49.37.128.9", device: "Safari 19 · macOS", location: "Bengaluru, IN", method: "password only", outcome: "failed", reason: "Incorrect 2FA code (attempt 1 of 5)" },
  { id: "LG-4393", at: "2026-08-15T13:27:00Z", ip: "103.94.216.44", device: "Members Trail app · iPhone 16", location: "Mohali, IN", method: "Apple OAuth", outcome: "success" },
  { id: "LG-4392", at: "2026-08-12T08:49:00Z", ip: "94.200.31.187", device: "Chrome 140 · Android 16", location: "Dubai, AE", method: "password + TOTP", outcome: "success" },
  { id: "LG-4391", at: "2026-08-11T19:03:00Z", ip: "185.220.101.34", device: "Firefox 132 · Linux", location: "Unknown · Tor exit node", method: "password only", outcome: "blocked", reason: "Anonymising network — sign-in refused before password check" },
  { id: "LG-4390", at: "2026-08-09T07:52:00Z", ip: "103.94.216.44", device: "Chrome 141 · Windows 11", location: "Mohali, IN", method: "password + TOTP", outcome: "success" },
];

/** Manual-entry secret shown alongside the TOTP QR code. */
export const TOTP_SECRET = "JBSW Y3DP EHPK 3PXP MTT7 4QKA";
export const TOTP_ISSUER = "Members Trail";
export const TOTP_ACCOUNT = "navdeep@example.com";
export const TOTP_URI =
  `otpauth://totp/${encodeURIComponent(TOTP_ISSUER)}:${encodeURIComponent(TOTP_ACCOUNT)}` +
  `?secret=${TOTP_SECRET.replace(/\s/g, "")}&issuer=${encodeURIComponent(TOTP_ISSUER)}&algorithm=SHA1&digits=6&period=30`;
