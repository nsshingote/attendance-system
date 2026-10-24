import assert from "node:assert/strict";
import test from "node:test";
import { getCurrentLocation } from "./location.ts";

function makePosition({ accuracy, timestamp = Date.now(), latitude = 37.7749, longitude = -122.4194 }) {
  return {
    coords: { latitude, longitude, accuracy },
    timestamp,
  };
}

function makeGeolocationError(code) {
  return Object.assign(new Error("geolocation failed"), {
    code,
    PERMISSION_DENIED: 1,
    POSITION_UNAVAILABLE: 2,
    TIMEOUT: 3,
  });
}

async function withGeolocation(responses, run) {
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const calls = [];

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { isSecureContext: true },
  });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      geolocation: {
        getCurrentPosition(success, failure, options) {
          calls.push(options);
          const response = responses.shift();
          if (response instanceof Error) failure(response);
          else success(response);
        },
      },
    },
  });

  try {
    await run(calls);
  } finally {
    if (originalNavigator) Object.defineProperty(globalThis, "navigator", originalNavigator);
    else delete globalThis.navigator;
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else delete globalThis.window;
  }
}

test("reuses cached readings at the configured 200 m and 300 m accuracy boundaries", async () => {
  for (const radius of [200, 300]) {
    const cached = makePosition({ accuracy: radius });
    await withGeolocation([cached], async (calls) => {
      const position = await getCurrentLocation("check in", radius);
      assert.equal(position, cached);
      assert.deepEqual(calls, [{ enableHighAccuracy: true, timeout: 0, maximumAge: 60_000 }]);
    });
  }
});

test("preserves onsite behavior for a recent cached reading with poor accuracy", async () => {
  const cached = makePosition({ accuracy: 180 });

  await withGeolocation([cached], async (calls) => {
    assert.equal(await getCurrentLocation("check in", null), cached);
    assert.equal(calls.length, 1);
  });
});

test("requests a fresh reading instead of reusing a cached reading worse than the configured limit", async () => {
  const cached = makePosition({ accuracy: 200.1 });
  const fresh = makePosition({ accuracy: 24, latitude: 37.775, longitude: -122.4195 });

  await withGeolocation([cached, fresh], async (calls) => {
    const position = await getCurrentLocation("check in", 200);
    assert.equal(position, fresh);
    assert.deepEqual(calls, [
      { enableHighAccuracy: true, timeout: 0, maximumAge: 60_000 },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 },
    ]);
  });
});

test("applies configured 200 m and 300 m accuracy limits to fresh readings and boundaries", async () => {
  for (const radius of [200, 300]) {
    const cached = makePosition({ accuracy: radius + 1 });
    const freshAtBoundary = makePosition({ accuracy: radius });
    await withGeolocation([cached, freshAtBoundary], async () => {
      assert.equal(await getCurrentLocation("check in", radius), freshAtBoundary);
    });

    const freshAboveBoundary = makePosition({ accuracy: radius + 0.1 });
    await withGeolocation([cached, freshAboveBoundary], async () => {
      await assert.rejects(
        getCurrentLocation("check in", radius),
        new RegExp(`LOCATION_INACCURATE: GPS accuracy must be ${radius} metres or better`),
      );
    });
  }
});

test("turns a fresh-location timeout into the existing actionable location error", async () => {
  const cached = makePosition({ accuracy: 150 });
  const timeout = makeGeolocationError(3);

  await withGeolocation([cached, timeout], async (calls) => {
    await assert.rejects(getCurrentLocation("check out", 100), /Getting your location took too long/);
    assert.equal(calls.length, 2);
    assert.equal(calls[1].maximumAge, 0);
  });
});
