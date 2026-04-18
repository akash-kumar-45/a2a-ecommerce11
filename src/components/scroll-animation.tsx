"use client";

import { useEffect, useRef, useState } from "react";

const TOTAL_FRAMES = 294;
const FRAME_PATH = (n: number) =>
  `/segment2/ezgif-frame-${String(n).padStart(3, "0")}.jpg`;

export function ScrollAnimation() {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameIndexRef = useRef(1);
  const imagesRef = useRef<HTMLImageElement[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [progress, setProgress] = useState(0);

  // Preload all frames
  useEffect(() => {
    let loadedCount = 0;
    const images: HTMLImageElement[] = [];

    for (let i = 1; i <= TOTAL_FRAMES; i++) {
      const img = new Image();
      img.src = FRAME_PATH(i);
      img.onload = () => {
        loadedCount++;
        if (loadedCount === TOTAL_FRAMES) {
          imagesRef.current = images;
          setLoaded(true);
          renderFrame(1, images);
        }
      };
      images.push(img);
    }
  }, []);

  function renderFrame(index: number, images?: HTMLImageElement[]) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const imgs = images ?? imagesRef.current;
    const img = imgs[index - 1];
    if (!img) return;

    canvas.width = img.naturalWidth || 1920;
    canvas.height = img.naturalHeight || 1080;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  }

  // Map scroll position to frame
  useEffect(() => {
    if (!loaded) return;

    const handleScroll = () => {
      const container = containerRef.current;
      if (!container) return;

      const rect = container.getBoundingClientRect();
      const containerHeight = container.offsetHeight;
      const windowH = window.innerHeight;

      // How far we've scrolled through the sticky section
      const scrolled = -rect.top;
      const maxScroll = containerHeight - windowH;
      const p = Math.min(Math.max(scrolled / maxScroll, 0), 1);

      setProgress(p);

      const frameIndex = Math.min(
        Math.max(Math.round(p * (TOTAL_FRAMES - 1)) + 1, 1),
        TOTAL_FRAMES
      );

      if (frameIndex !== frameIndexRef.current) {
        frameIndexRef.current = frameIndex;
        renderFrame(frameIndex);
      }
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll();
    return () => window.removeEventListener("scroll", handleScroll);
  }, [loaded]);

  return (
    <div
      ref={containerRef}
      className="relative"
      style={{ height: `${TOTAL_FRAMES * 4}px` }}
    >
      {/* Sticky frame canvas */}
      <div className="sticky top-0 h-screen w-full overflow-hidden bg-black flex items-center justify-center">
        {!loaded && (
          <div className="flex flex-col items-center gap-4">
            <div className="w-12 h-12 border-2 border-cyan-500/30 border-t-cyan-400 rounded-full animate-spin" />
            <p className="text-xs font-mono text-zinc-500 tracking-widest">
              LOADING SEQUENCE...
            </p>
          </div>
        )}

        <canvas
          ref={canvasRef}
          className="w-full h-full object-cover"
          style={{ opacity: loaded ? 1 : 0, transition: "opacity 0.3s" }}
        />

        {/* Overlay content */}
        {loaded && (
          <>
            {/* Progress bar */}
            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2">
              <div className="w-40 h-px bg-zinc-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-cyan-400 transition-all duration-75"
                  style={{ width: `${progress * 100}%` }}
                />
              </div>
              <p className="text-[9px] font-mono text-zinc-600 tracking-[0.2em]">
                SCROLL TO EXPLORE
              </p>
            </div>

            {/* Top label */}
            <div className="absolute top-6 left-6 flex items-center gap-2">
              <span className="text-[9px] font-mono text-zinc-600 tracking-[0.15em]">
                FRAME {frameIndexRef.current} / {TOTAL_FRAMES}
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
