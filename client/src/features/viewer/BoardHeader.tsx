import { NavLink } from 'react-router-dom';

/** The /board header with the switch between the ring view and the brackets. */
export default function BoardHeader() {
  const tab = ({ isActive }: { isActive: boolean }) =>
    `px-3 py-1.5 rounded-lg text-sm font-bold uppercase tracking-wider ${isActive ? 'bg-zinc-100 text-black' : 'text-zinc-400 hover:text-white'}`;
  return (
    <header className="w-full flex items-center justify-between gap-3 px-4 h-14 border-b border-zinc-800 flex-shrink-0">
      <h1 className="min-w-0 text-lg font-black text-white tracking-widest uppercase truncate">
        Kickboxing <span className="text-zinc-500 font-light">Live</span>
      </h1>
      <nav className="flex gap-1 flex-shrink-0">
        <NavLink to="/board" end className={tab}>Ring</NavLink>
        <NavLink to="/board/brackets" className={tab}>Brackets</NavLink>
      </nav>
    </header>
  );
}
