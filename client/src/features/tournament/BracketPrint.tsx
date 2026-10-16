import type { ReactElement } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import type { Bracket, BracketMatch, TournamentState, WeightCategory } from '../../api/protocol';

// Bracket protocol for signing (§8): A4 landscape, black on white, the whole
// bracket with each winner and method, placings, tournament name and date, and
// signature lines for the chief judge and the secretary. Printed or saved as
// PDF from the browser.

const PAGE_CSS = `
@page { size: A4 landscape; margin: 10mm; }
@media print {
  html, body { background: #fff !important; }
  .no-print { display: none !important; }
}
`;

const W = 1000;      // SVG width in user units
const CARD_H = 38;
const GAP = 10;
const MIN_H = 420;   // keeps small brackets from looking stretched

function shorten(name: string, max = 26) {
  return name.length > max ? name.slice(0, max - 1) + '…' : name;
}

function roundLabel(round: number, total: number) {
  if (round === total) return 'Финал';
  if (round === total - 1) return '1/2 финала';
  if (round === total - 2) return '1/4 финала';
  return `1/${2 ** (total - round)} финала`;
}

function methodText(m: BracketMatch) {
  if (m.status === 'BYE') return m.winner_id ? 'без боя' : '';
  if (m.status !== 'COMPLETED') return '';
  const corrected = m.corrections?.length ? ' *' : '';
  return `${m.method ?? ''}${m.votes ? ' ' + m.votes : ''}${corrected}`;
}

function BracketSvg({ bracket }: { bracket: Bracket }) {
  const rounds = bracket.total_rounds;
  const firstRoundSlots = 2 ** Math.max(rounds - 1, 0);
  const H = Math.max(firstRoundSlots * (CARD_H + GAP), MIN_H);
  const LABEL = 22;
  const colW = W / (rounds + 1);
  const cardW = colW * 0.84;
  const centerY = (round: number, pos: number) => LABEL + ((pos + 0.5) * (H - LABEL)) / (firstRoundSlots / 2 ** (round - 1));
  const byPos = new Map(bracket.matches.map(m => [`${m.round}:${m.position}`, m]));
  const elements: ReactElement[] = [];

  for (let r = 1; r <= rounds; r++) {
    const x = (r - 1) * colW;
    elements.push(<text key={`l${r}`} x={x + cardW / 2} y={14} textAnchor="middle" fontSize={12} fontWeight={700}>{roundLabel(r, rounds)}</text>);
    const count = firstRoundSlots / 2 ** (r - 1);
    for (let p = 0; p < count; p++) {
      const cy = centerY(r, p);
      const y = cy - CARD_H / 2;
      const m = byPos.get(`${r}:${p}`);
      // Connector to the next round.
      if (r < rounds) {
        const nx = r * colW;
        const ny = centerY(r + 1, Math.floor(p / 2));
        elements.push(<path key={`c${r}-${p}`} d={`M${x + cardW} ${cy} H${(x + cardW + nx) / 2} V${ny} H${nx}`} fill="none" stroke="#999" strokeWidth={1} />);
      }
      const isBye = m?.status === 'BYE';
      const rows = [
        { id: m?.fighter_red_id ?? '', name: m?.fighter_red_name ?? '', corner: '#c00' },
        { id: m?.fighter_blue_id ?? '', name: m?.fighter_blue_name ?? '', corner: '#0050c8' },
      ];
      elements.push(
        <g key={`m${r}-${p}`}>
          <rect x={x} y={y} width={cardW} height={CARD_H} fill="#fff" stroke="#333" strokeWidth={1} rx={3} />
          <line x1={x} x2={x + cardW} y1={cy} y2={cy} stroke="#ccc" strokeWidth={0.8} />
          {rows.map((row, i) => {
            const won = !!m?.winner_id && m.winner_id === row.id;
            const label = row.name ? shorten(row.name) : isBye && r === 1 ? 'BYE' : '';
            return (
              <g key={i}>
                <rect x={x} y={y + (i * CARD_H) / 2 + 3} width={3} height={CARD_H / 2 - 6} fill={row.corner} />
                <text x={x + 8} y={y + (i * CARD_H) / 2 + CARD_H / 4 + 4} fontSize={11} fontWeight={won ? 800 : 400} fill={row.name ? '#000' : '#999'}>
                  {label}{won ? ' ✓' : ''}
                </text>
              </g>
            );
          })}
          {m && methodText(m) && (
            <text x={x + cardW - 4} y={y + CARD_H + 9} fontSize={9} textAnchor="end" fill="#444">{methodText(m)}</text>
          )}
        </g>,
      );
    }
  }

  // Champion
  const final = byPos.get(`${rounds}:0`);
  const champ = final && (final.status === 'COMPLETED' || final.status === 'BYE') && final.winner_id
    ? (final.winner_id === final.fighter_red_id ? final.fighter_red_name : final.fighter_blue_name) : '';
  const cx = rounds * colW;
  const cy = centerY(rounds, 0);
  elements.push(
    <g key="champ">
      <line x1={(rounds - 1) * colW + cardW} x2={cx} y1={cy} y2={cy} stroke="#999" />
      <text x={cx + 6} y={cy - 12} fontSize={11} fontWeight={700}>Победитель</text>
      <text x={cx + 6} y={cy + 6} fontSize={13} fontWeight={800}>{shorten(champ, 24) || '—'}</text>
    </g>,
  );

  return (
    <svg viewBox={`0 0 ${W} ${H + 14}`} width="100%" style={{ maxHeight: '128mm', display: 'block' }} fontFamily="Arial, Helvetica, sans-serif">
      {elements}
    </svg>
  );
}

function fighterLine(category: WeightCategory, id: string) {
  const f = category.fighters.find(x => x.id === id);
  if (!f) return '';
  return [f.name, f.club, f.city].filter(Boolean).join(', ');
}

export default function BracketPrint({ tournament }: { tournament: TournamentState }) {
  const { categoryId } = useParams<{ categoryId: string }>();
  const navigate = useNavigate();
  const category = tournament.categories.find(c => c.id === categoryId);
  const bracket = categoryId ? tournament.brackets?.[categoryId] : undefined;

  if (!category || !bracket?.generated) {
    return <div className="p-8 text-zinc-500">Сетка не найдена или ещё не создана.</div>;
  }

  const { first, second, third } = bracket.placings ?? { first: '', second: '', third: [] };
  const places: [string, string][] = [['1', first], ['2', second], ['3', third[0] ?? ''], ['3', third[1] ?? '']];
  const corrected = bracket.matches.some(m => m.corrections?.length);

  return (
    <div className="min-h-screen bg-white text-black">
      <style>{PAGE_CSS}</style>
      <div className="no-print flex gap-3 p-4 bg-zinc-100 border-b border-zinc-300">
        <button onClick={() => window.print()} className="px-4 py-2 bg-black text-white rounded-lg font-bold cursor-pointer">
          Печать / сохранить в PDF
        </button>
        <button onClick={() => navigate(-1)} className="px-4 py-2 bg-zinc-200 rounded-lg font-bold cursor-pointer">Назад</button>
        <span className="text-sm text-zinc-500 self-center">A4, альбомная. В диалоге печати выберите «Сохранить как PDF».</span>
      </div>

      <div className="mx-auto p-[6mm] print:p-0" style={{ maxWidth: '277mm', fontFamily: 'Arial, Helvetica, sans-serif' }}>
        <header className="flex justify-between items-end border-b-2 border-black pb-2 mb-3">
          <div>
            <div className="text-lg font-black">{tournament.name || 'Турнир'}</div>
            <div className="text-sm">
              Категория: <b>{category.name}</b> · {[category.sex === 'female' ? 'женщины' : 'мужчины', category.gender, category.discipline].filter(Boolean).join(' · ')} · участников: {category.fighters.length}
            </div>
          </div>
          <div className="text-sm text-right">Дата: <b>{tournament.date || '____________'}</b></div>
        </header>

        <BracketSvg bracket={bracket} />

        <div className="flex justify-between gap-8 mt-3 text-sm" style={{ breakInside: 'avoid' }}>
          <table className="border-collapse">
            <tbody>
              {places.map(([place, id], i) => (
                <tr key={i}>
                  <td className="pr-3 font-black">{place} место</td>
                  <td className="border-b border-black min-w-[90mm]">{id ? fighterLine(category, id) : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex flex-col justify-end gap-5 min-w-[95mm]">
            <div>Главный судья ______________________</div>
            <div>Секретарь ______________________</div>
          </div>
        </div>
        <div className="text-[9px] text-zinc-600 mt-2">
          PTS — по очкам (голоса судей), KO — нокаут, RSC — остановка рефери, DQ — дисквалификация, AB — отказ, WO — неявка.
          {corrected && ' * — результат исправлен главным судьёй.'}
        </div>
      </div>
    </div>
  );
}
