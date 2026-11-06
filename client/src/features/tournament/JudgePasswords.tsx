import { useState } from 'react';
import { Lock, LockOpen } from 'lucide-react';
import type { SetJudgePasswordPayload } from '../../api/protocol';
import { sendAction } from '../../api/socket';
import { useJudgeAccess } from '../../shared/useJudgeAccess';

/** The judges' seat passwords. The server keeps only hashes, so a password
 *  can be replaced or removed here but never shown again. */
export default function JudgePasswords() {
  const access = useJudgeAccess();
  return (
    <div className="border-t border-zinc-800">
      <div className="px-4 py-3 text-xs font-bold text-zinc-500 uppercase tracking-widest">Judge passwords</div>
      <div className="px-4 pb-4 flex flex-col gap-2">
        {[1, 2, 3].map(seat => <SeatPassword key={seat} seat={seat} isSet={access.protected[seat - 1]} />)}
        <div className="text-[11px] text-zinc-500">Judges open /judge on their phones. Judges already connected stay connected when a password changes.</div>
      </div>
    </div>
  );
}

function SeatPassword({ seat, isSet }: { seat: number; isSet: boolean }) {
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const save = async (password: string) => {
    const payload: SetJudgePasswordPayload = { seat, password };
    const r = await sendAction('SET_JUDGE_PASSWORD', payload);
    setError(r.ok ? '' : `Not saved: ${r.reason}`);
    if (r.ok) setValue('');
  };
  return (
    <div>
      <div className="flex items-center gap-2">
        <span title={isSet ? 'Password set' : 'No password: anyone can open this seat'} className={isSet ? 'text-emerald-500' : 'text-zinc-600'}>
          {isSet ? <Lock size={14} /> : <LockOpen size={14} />}
        </span>
        <span className="text-white text-sm font-bold w-14">Judge {seat}</span>
        <input
          type="text"
          value={value}
          onChange={e => setValue(e.target.value)}
          placeholder={isSet ? 'New password' : 'Set password'}
          className="flex-1 min-w-0 px-2 py-1 bg-zinc-800 border border-zinc-700 rounded-lg text-white text-sm placeholder-zinc-500"
        />
        {value ? (
          <button onClick={() => save(value)} className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-lg cursor-pointer">Save</button>
        ) : isSet && (
          <button onClick={() => save('')} className="px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-bold rounded-lg cursor-pointer">Remove</button>
        )}
      </div>
      {error && <div className="text-red-400 text-xs mt-1">{error}</div>}
    </div>
  );
}
