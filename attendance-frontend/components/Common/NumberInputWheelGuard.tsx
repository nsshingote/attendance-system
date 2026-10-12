"use client";

import { useEffect } from "react";

export default function NumberInputWheelGuard() {
  useEffect(() => {
    const blurNumberInputOnWheel = (event: WheelEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLInputElement
        && target.type === "number"
        && target.classList.contains("number-input-no-spinner")
      ) {
        target.blur();
      }
    };

    document.addEventListener("wheel", blurNumberInputOnWheel, { capture: true, passive: true });
    return () => document.removeEventListener("wheel", blurNumberInputOnWheel, true);
  }, []);

  return null;
}
