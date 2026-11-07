import { type ReactNode, useLayoutEffect, useRef, useState } from 'react';

/** Scales its content to fill the available space (up to maxScale), so a bracket reads from across the hall. */
export default function FitToScreen({ children, maxScale = 2.5 }: { children: ReactNode; maxScale?: number }) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [size, setSize] = useState({ w: 0, h: 0 });

  useLayoutEffect(() => {
    const fit = () => {
      if (!outer.current || !inner.current) return;
      const w = inner.current.offsetWidth, h = inner.current.offsetHeight;
      if (!w || !h) return;
      const { clientWidth, clientHeight } = outer.current;
      setSize({ w, h });
      setScale(Math.max(0.3, Math.min(maxScale, clientWidth / w, clientHeight / h)));
    };
    fit();
    const ro = new ResizeObserver(fit);
    if (outer.current) ro.observe(outer.current);
    if (inner.current) ro.observe(inner.current);
    return () => ro.disconnect();
  }, [maxScale]);

  return (
    <div ref={outer} className="flex-1 min-h-0 min-w-0 w-full overflow-hidden flex items-center justify-center">
      <div style={{ width: size.w * scale, height: size.h * scale }} className="relative flex-shrink-0">
        <div ref={inner} style={{ transform: `scale(${scale})`, transformOrigin: 'top left' }} className="absolute top-0 left-0 w-max">
          {children}
        </div>
      </div>
    </div>
  );
}
