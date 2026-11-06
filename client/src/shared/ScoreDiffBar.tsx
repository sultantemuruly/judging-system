interface Props {
  /** Red total minus Blue total for one judge. */
  diff: number;
  size?: 'md' | 'lg';
}

const sizes = {
  md: { row: 'min-h-[20px] gap-0.5', block: 'w-4 h-5', divider: 'w-px h-6', glowRed: 'shadow-[0_0_6px_rgba(239,68,68,0.5)]', glowBlue: 'shadow-[0_0_6px_rgba(59,130,246,0.5)]' },
  lg: { row: 'min-h-[40px] gap-1', block: 'w-6 h-8', divider: 'w-0.5 h-10', glowRed: 'shadow-[0_0_12px_rgba(239,68,68,0.6)]', glowBlue: 'shadow-[0_0_12px_rgba(59,130,246,0.6)]' },
};

/** One block per point of difference, on the side of the judge's leader. */
export default function ScoreDiffBar({ diff, size = 'md' }: Props) {
  const s = sizes[size];
  const blocks = Array.from({ length: Math.abs(diff) });
  const fade = (i: number) => (size === 'lg' ? { opacity: 0.5 + Math.min((i / Math.abs(diff)) * 0.5, 0.5) } : undefined);

  return (
    <div className={`flex items-center justify-center w-full ${s.row}`}>
      <div className="flex-1 flex flex-wrap-reverse justify-end gap-1 pr-2">
        {diff > 0 && blocks.map((_, i) => (
          <div key={i} className={`${s.block} rounded-sm bg-red-500 ${s.glowRed}`} style={fade(i)} />
        ))}
      </div>
      <div className={`${s.divider} bg-zinc-600 flex-shrink-0`} />
      <div className="flex-1 flex flex-wrap justify-start gap-1 pl-2">
        {diff < 0 && blocks.map((_, i) => (
          <div key={i} className={`${s.block} rounded-sm bg-blue-500 ${s.glowBlue}`} style={fade(i)} />
        ))}
      </div>
    </div>
  );
}
