/**
 * lib/device.ts
 * Generates and persists a stable per-browser device token, and reads
 * device/browser display names using react-device-detect + ua-parser-js —
 * used by the login flow to enforce "employees can only log in from a
 * registered device/browser".
 */

import { isMobile, isTablet, deviceType, osName, browserName } from "react-device-detect";
import { UAParser } from "ua-parser-js";

const DEVICE_TOKEN_KEY = "ams_device_token";

/** Returns a persistent random token identifying this browser, creating one if needed. */
export function getDeviceToken(): string {
  if (typeof window === "undefined") return "";

  let token = localStorage.getItem(DEVICE_TOKEN_KEY);
  if (!token) {
    token = generateUUID();
    localStorage.setItem(DEVICE_TOKEN_KEY, token);
  }
  return token;
}

function generateUUID(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** Human-readable device name, e.g. "Windows Desktop" or "iPhone (Mobile)". */
export function getDeviceName(): string {
  if (typeof window === "undefined") return "Unknown Device";

  const parser = new UAParser(navigator.userAgent);
  const device = parser.getDevice();
  const os = osName || parser.getOS().name || "Unknown OS";

  if (device.vendor && device.model) {
    return `${device.vendor} ${device.model}`;
  }

  const type = isMobile ? "Mobile" : isTablet ? "Tablet" : "Desktop";
  return `${os} ${type}`.trim();
}

/** Human-readable browser name, e.g. "Chrome 126". */
export function getBrowserName(): string {
  if (typeof window === "undefined") return "Unknown Browser";

  const parser = new UAParser(navigator.userAgent);
  const browser = parser.getBrowser();
  const name = browserName || browser.name || "Unknown Browser";
  const version = browser.version ? browser.version.split(".")[0] : "";

  return version ? `${name} ${version}` : name;
}

export interface DeviceInfo {
  device_token: string;
  device_name: string;
  browser_name: string;
}

export function getDeviceInfo(): DeviceInfo {
  return {
    device_token: getDeviceToken(),
    device_name: getDeviceName(),
    browser_name: getBrowserName(),
  };
}