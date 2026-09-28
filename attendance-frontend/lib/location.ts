/** Get a fresh browser location for attendance validation. */
export function getCurrentLocation(action: "check in" | "check out"): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined" || !navigator.geolocation) {
      const secureContextHint = typeof window !== "undefined" && !window.isSecureContext
        ? " Open this site using HTTPS, which is required for location access on iPhone."
        : "";
      reject(new Error(`LOCATION_REQUIRED: Location is unavailable.${secureContextHint}`));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      resolve,
      (error) => {
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
        reject(new Error(`LOCATION_REQUIRED: Location is required to ${action} onsite. ${detail}`));
      },
      {
        enableHighAccuracy: true,
        timeout: 20000,
        maximumAge: 0,
      },
    );
  });
}
