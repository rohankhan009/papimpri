import { useEffect } from "react";

// Global click "boom" — neon particle burst + shockwave ring at the pointer.
export default function ClickFX() {
  useEffect(() => {
    const layer = document.createElement("div");
    layer.className = "lb-fx-layer";
    document.body.appendChild(layer);

    const COLORS = ["#00f0ff", "#ff2bd6", "#b6ff3c", "#ffe600"];

    const boom = (x, y) => {
      // shockwave ring
      const ring = document.createElement("span");
      ring.className = "lb-fx-ring";
      ring.style.left = x + "px";
      ring.style.top = y + "px";
      ring.style.borderColor = COLORS[Math.floor(Math.random() * COLORS.length)];
      layer.appendChild(ring);
      ring.addEventListener("animationend", () => ring.remove());

      // spark particles
      const n = 10;
      for (let i = 0; i < n; i++) {
        const p = document.createElement("span");
        p.className = "lb-fx-spark";
        const ang = (Math.PI * 2 * i) / n + Math.random() * 0.5;
        const dist = 26 + Math.random() * 34;
        p.style.left = x + "px";
        p.style.top = y + "px";
        p.style.setProperty("--dx", Math.cos(ang) * dist + "px");
        p.style.setProperty("--dy", Math.sin(ang) * dist + "px");
        p.style.background = COLORS[Math.floor(Math.random() * COLORS.length)];
        layer.appendChild(p);
        p.addEventListener("animationend", () => p.remove());
      }
    };

    const onDown = (e) => {
      const x = e.clientX, y = e.clientY;
      if (x == null) return;
      boom(x, y);
    };
    window.addEventListener("pointerdown", onDown, true);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      layer.remove();
    };
  }, []);
  return null;
}
