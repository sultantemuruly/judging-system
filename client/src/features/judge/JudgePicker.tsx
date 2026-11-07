import JudgeSeatLinks from '../../shared/JudgeSeatLinks';

/** /judge: where a judge picks their seat. */
export default function JudgePicker() {
  return (
    <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center gap-4 p-4">
      <h1 className="text-zinc-400 text-sm font-black uppercase tracking-widest mb-2">Выберите место судьи</h1>
      <div className="w-full max-w-sm flex flex-col gap-4">
        <JudgeSeatLinks />
      </div>
    </div>
  );
}
