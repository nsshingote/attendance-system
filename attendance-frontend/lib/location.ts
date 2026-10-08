const MAX_CACHED_LOCATION_AGE_MS = 60_000;
const FRESH_LOCATION_TIMEOUT_MS = 10_000;

function requestLocation(options: PositionOptions): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, options);
  });
}

function hasUsableCoordinates(position: GeolocationPosition): boolean {
  const { latitude, longitude, accuracy } = position.coords;
  return Number.isFinite(latitude)
    && latitude >= -90
    && latitude <= 90
    && Number.isFinite(longitude)
    && longitude >= -180
    && longitude <= 180
    && Number.isFinite(accuracy)
    && accuracy >= 0;
}

function isRecentUsablePosition(position: GeolocationPosition): boolean {
  const age = Date.now() - position.timestamp;
  return hasUsableCoordinates(position) && age >= 0 && age <= MAX_CACHED_LOCATION_AGE_MS;
}

function isPermissionDenied(error: unknown): error is GeolocationPositionError {
  return typeof error === "object" && error !== null && "code" in error && error.code === 1;
}

function locationError(action: "check in" | "check out", error: GeolocationPositionError): Error {
  let detail: string;
  switch (error.code) {
    case error.PERMISSION_DENIED:
      detail = "Allow location access for this site in your browser and iPhone Settings, then try again.";
      break;
    case error.POSITION_UNAVAILABLE:
      detail = "Your current location could not be determined. Check that Location Services are on and try again.";
      break;
    case error.TIMEOUT:
      detail = "Getting your location took too long. Check that Location Services are on and try again.";
      break;
    default:
      detail = "Enable location access and try again.";
  }
  return new Error(`LOCATION_REQUIRED: Location is required to ${action} onsite. ${detail}`);
}

/** Reuse a recent browser fix when possible, then fall back to a fresh fix. */
export function getCurrentLocation(action: "check in" | "check out"): Promise<GeolocationPosition> {
  if (typeof window === "undefined" || !navigator.geolocation) {
    const secureContextHint = typeof window !== "undefined" && !window.isSecureContext
      ? " Open this site using HTTPS, which is required for location access on iPhone."
      : "";
    return Promise.reject(new Error(`LOCATION_REQUIRED: Location is unavailable.${secureContextHint}`));
  }

  return (async () => {
    try {
      const cachedPosition = await requestLocation({
        enableHighAccuracy: true,
        timeout: 0,
        maximumAge: MAX_CACHED_LOCATION_AGE_MS,
      });
      if (isRecentUsablePosition(cachedPosition)) return cachedPosition;
    } catch (error) {
      if (isPermissionDenied(error)) throw locationError(action, error);
    }

    let freshPosition: GeolocationPosition;
    try {
      freshPosition = await requestLocation({
        enableHighAccuracy: true,
        timeout: FRESH_LOCATION_TIMEOUT_MS,
        maximumAge: 0,
      });
    } catch (error) {
      throw locationError(action, error as GeolocationPositionError);
    }

    if (hasUsableCoordinates(freshPosition)) return freshPosition;
    throw new Error(`LOCATION_REQUIRED: Location is required to ${action} onsite. Your current location could not be determined. Check that Location Services are on and try again.`);
  })();
}
