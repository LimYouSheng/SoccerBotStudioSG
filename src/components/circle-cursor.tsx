"use client";

import { useEffect, useRef } from "react";

export function CircleCursor() {
  const ringRef = useRef<HTMLDivElement>(null);
  const dotRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ring = ringRef.current;
    const dot = dotRef.current;
    if (!ring || !dot) return;
    const eligible = window.matchMedia(
      "(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference) and (forced-colors: none)",
    );
    let frame = 0;
    let visible = false;
    let x = 0;
    let y = 0;
    let dotX = 0;
    let dotY = 0;
    let previousTime = 0;

    function hide() {
      visible = false;
      ring!.hidden = true;
      dot!.hidden = true;
      document.documentElement.classList.remove("circle-cursor-active");
      cancelAnimationFrame(frame);
      frame = 0;
      previousTime = 0;
    }
    function animate(time: number) {
      const delta = previousTime ? Math.min(time - previousTime, 64) : 16;
      previousTime = time;
      const ease = 1 - Math.exp(-delta / 65);
      dotX += (x - dotX) * ease;
      dotY += (y - dotY) * ease;
      // Keep the trailing dot inside the ring, including fast pointer moves.
      const distance = Math.hypot(dotX - x, dotY - y);
      if (distance > 8) {
        dotX = x + ((dotX - x) / distance) * 8;
        dotY = y + ((dotY - y) / distance) * 8;
      }
      dot!.style.transform = `translate3d(${dotX}px, ${dotY}px, 0)`;
      frame =
        Math.hypot(x - dotX, y - dotY) > 0.1
          ? requestAnimationFrame(animate)
          : 0;
      if (!frame) previousTime = 0;
    }
    function move(event: PointerEvent) {
      const target = event.target;
      if (
        !eligible.matches ||
        event.pointerType !== "mouse" ||
        (target instanceof Element &&
          target.closest(
            "input, textarea, select, [contenteditable], iframe, :disabled",
          ))
      ) {
        hide();
        return;
      }
      x = event.clientX;
      y = event.clientY;
      if (!visible) {
        dotX = x;
        dotY = y;
        visible = true;
        ring!.hidden = false;
        dot!.hidden = false;
        document.documentElement.classList.add("circle-cursor-active");
      }
      ring!.style.transform = `translate3d(${x}px, ${y}px, 0)`;
      if (!frame) frame = requestAnimationFrame(animate);
    }
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerover", move);
    document.documentElement.addEventListener("pointerleave", hide);
    document.addEventListener("visibilitychange", hide);
    document.addEventListener("keydown", hide);
    window.addEventListener("blur", hide);
    eligible.addEventListener("change", hide);
    return () => {
      hide();
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerover", move);
      document.documentElement.removeEventListener("pointerleave", hide);
      document.removeEventListener("visibilitychange", hide);
      document.removeEventListener("keydown", hide);
      window.removeEventListener("blur", hide);
      eligible.removeEventListener("change", hide);
    };
  }, []);

  return (
    <>
      <div
        ref={ringRef}
        className="circle-cursor-ring"
        aria-hidden="true"
        hidden
      />
      <div
        ref={dotRef}
        className="circle-cursor-dot"
        aria-hidden="true"
        hidden
      />
    </>
  );
}
