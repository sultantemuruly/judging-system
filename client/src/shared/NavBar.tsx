import type { ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { LogOut, Monitor } from 'lucide-react';
import { logoutAdmin } from '../api/socket';

/** The operator's pages, one click apart: the ring and the three tournament pages. */
const pages = [
  { to: '/', label: 'Ring', match: (p: string) => p === '/' },
  { to: '/tournament/setup', label: 'Categories', match: (p: string) => p.startsWith('/tournament/setup') },
  { to: '/tournament/brackets', label: 'Brackets', match: (p: string) => p.startsWith('/tournament/bracket') },
  { to: '/tournament/schedule', label: 'Schedule', match: (p: string) => p.startsWith('/tournament/schedule') },
];

/** Top bar of every operator page; `children` go on the right (page actions). */
export default function NavBar({ children }: { children?: ReactNode }) {
  const { pathname } = useLocation();
  return (
    <nav className="w-full flex items-center gap-1 px-4 h-14 border-b border-zinc-800 bg-zinc-950 flex-shrink-0">
      {pages.map(p => (
        <NavLink
          key={p.to}
          to={p.to}
          className={`px-4 py-2 rounded-lg text-sm font-bold ${p.match(pathname) ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-white'}`}
        >
          {p.label}
        </NavLink>
      ))}
      <div className="ml-auto flex items-center gap-3">
        {children}
        <a href="/board" target="_blank" rel="noreferrer" title="Open the public scoreboard (no login) in a new tab" className="flex items-center gap-1.5 px-3 py-2 text-sm font-bold text-zinc-400 hover:text-white">
          <Monitor size={15} /> Board
        </a>
        <button onClick={logoutAdmin} title="Log out" className="p-2 text-zinc-500 hover:text-white cursor-pointer"><LogOut size={16} /></button>
      </div>
    </nav>
  );
}
