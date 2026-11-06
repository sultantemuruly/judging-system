import { useState } from 'react';
import { type FightFormat, type WeightCategory, defaultFormat } from '../../api/protocol';
import { sendAction } from '../../api/socket';

const field = 'mt-1.5 w-full px-3 py-2 bg-zinc-950 border border-zinc-700 rounded-lg text-white text-sm focus:outline-none focus:border-zinc-400';
const label = 'block text-xs font-bold text-zinc-400';
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

/** Add or edit a weight category: who fights in it and its fight format (§2) and knockdown limits (§5). */
export default function CategoryDialog({ category, onClose }: { category?: WeightCategory; onClose: () => void }) {
  const [name, setName] = useState(category?.name ?? '');
  const [sex, setSex] = useState(category?.sex || 'male');
  const [gender, setGender] = useState(category?.gender || 'Seniors');
  const [discipline, setDiscipline] = useState(category?.discipline || 'low-kick');
  const [format, setFormat] = useState<FightFormat>(category?.format ?? defaultFormat);
  const set = (k: keyof FightFormat) => (e: { target: { value: string } }) => setFormat(f => ({ ...f, [k]: Number(e.target.value) }));

  const save = () => {
    if (!name.trim()) return;
    const payload = { name: name.trim(), sex, gender, discipline, ...format };
    if (category) sendAction('EDIT_CATEGORY', { category_id: category.id, ...payload });
    else sendAction('ADD_CATEGORY', payload);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[80] bg-black/70 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-zinc-900 border border-zinc-700 rounded-2xl p-6 max-w-lg w-full shadow-2xl" onClick={e => e.stopPropagation()}>
        <h2 className="text-xl font-black text-white mb-5">{category ? 'Edit category' : 'New category'}</h2>
        <div className="grid grid-cols-2 gap-4">
          <label className={`${label} col-span-2`}>Name
            <input autoFocus value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === 'Enter' && save()} placeholder="e.g. 65kg" className={field} />
          </label>
          <label className={label}>Sex
            <select value={sex} onChange={e => setSex(e.target.value)} className={field}>
              <option value="male">Men</option>
              <option value="female">Women</option>
            </select>
          </label>
          <label className={label}>Age group
            <select value={gender} onChange={e => setGender(e.target.value)} className={field}>
              <option value="Seniors">Seniors (17+)</option>
            </select>
          </label>
          <label className={`${label} col-span-2`}>Discipline
            <select value={discipline} onChange={e => setDiscipline(e.target.value)} className={field}>
              <option value="low-kick">Low-kick</option>
            </select>
          </label>
        </div>

        <div className="mt-6 mb-2 text-xs font-bold text-zinc-500 uppercase tracking-widest">Fight format</div>
        <div className="grid grid-cols-3 gap-4">
          <label className={label}>Rounds
            <select value={format.rounds} onChange={set('rounds')} className={field}>
              {[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <label className={label}>Round length
            <select value={format.round_seconds} onChange={set('round_seconds')} className={field}>
              {[60, 90, 120, 150, 180].map(n => <option key={n} value={n}>{mmss(n)}</option>)}
            </select>
          </label>
          <label className={label}>Rest
            <select value={format.rest_seconds} onChange={set('rest_seconds')} className={field}>
              {[30, 45, 60, 90, 120].map(n => <option key={n} value={n}>{mmss(n)}</option>)}
            </select>
          </label>
          <label className={label}>Knockdowns per round
            <input type="number" min={1} max={9} value={format.kd_limit_round} onChange={set('kd_limit_round')} className={field} />
          </label>
          <label className={label}>Knockdowns per fight
            <input type="number" min={1} max={9} value={format.kd_limit_fight} onChange={set('kd_limit_fight')} className={field} />
          </label>
        </div>

        <div className="flex gap-3 justify-end mt-7">
          <button className="px-5 py-2.5 bg-zinc-800 text-zinc-300 rounded-xl font-bold hover:bg-zinc-700 cursor-pointer" onClick={onClose}>Cancel</button>
          <button disabled={!name.trim()} onClick={save} className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-30 text-white rounded-xl font-bold cursor-pointer">
            {category ? 'Save' : 'Add category'}
          </button>
        </div>
      </div>
    </div>
  );
}
