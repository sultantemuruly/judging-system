import type { TournamentState, BracketMatch } from '../../api/protocol';
import NavBar from '../../shared/NavBar';

interface Props {
  tournament: TournamentState;
}

interface ScheduleRow {
  num: number;
  categoryId: string;
  categoryLabel: string;
  categoryName: string;
  categoryGender: string;
  categorySex: string;
  categoryDiscipline: string;
  match: BracketMatch;
  stage: string;
  stageOrder: number;
}

function parseWeight(name: string): number {
  const stringMatch = name.match(/(\d+(?:\.\d+)?)/);
  if (!stringMatch) return 999;
  let num = parseFloat(stringMatch[1]);
  if (name.includes('+')) num += 0.5;
  return num;
}

function getMatchPriority(row: Omit<ScheduleRow, 'num'>): number {
  const isSeniors = row.categoryGender === 'Seniors';
  const isMale = row.categorySex === 'male';
  const isFemale = row.categorySex === 'female';
  const is2012 = row.categoryGender === '2012-2013';
  const is2010 = row.categoryGender === '2010-2011';
  const isFC = row.categoryDiscipline === 'full-contact';
  const isLK = row.categoryDiscipline === 'low-kick';
  const isSF = row.stage === 'Semi-Final';
  const isQF = row.stage === 'Quarter-Final';
  const isFinal = row.stage === 'Final';
  const name = row.categoryName;

  // 1. Semi-finals: female Seniors (sorted by weight ascending)
  if (isSF && isSeniors && isFemale) return 10;

  // 2. Finals: male Seniors (sorted by weight ascending)
  if (isFinal && isSeniors && isMale) return 20;

  // 3. Finals: female Seniors (sorted by weight ascending)
  if (isFinal && isSeniors && isFemale) return 30;

  // 4. All other finals
  if (isFinal) return 40;

  // 5. Remaining matches
  if (isSF && is2012 && isFC) return 110;
  if (isQF && isSeniors) return 120;

  const isGroup3Weight = name.includes('57') || name.includes('67') || name.includes('71') || name.includes('91+');
  if (isSF && isSeniors && isGroup3Weight) return 130;

  if (isSF && is2010 && isFC) return 140;
  if (isSF && is2010 && isLK) return 150;
  if (isSF && isSeniors) return 160;

  if (isQF) return 170;
  if (isSF) return 180;

  return 200;
}

function getStageLabel(round: number, totalRounds: number): string {
  if (round === totalRounds) return 'Final';
  if (round === totalRounds - 1) return 'Semi-Final';
  if (round === totalRounds - 2) return 'Quarter-Final';
  const matchesInRound = Math.pow(2, totalRounds - round);
  return `Round of ${matchesInRound}`;
}

function getStageOrder(round: number): number {
  return round;
}

export default function MatchSchedule({ tournament }: Props) {
  const rows: Omit<ScheduleRow, 'num'>[] = [];

  for (const category of tournament.categories) {
    const bracket = tournament.brackets?.[category.id];
    if (!bracket?.generated) continue;

    const categoryLabel = [category.name, category.gender, category.discipline]
      .filter(Boolean)
      .join(' · ');

    for (const match of bracket.matches) {
      if (match.status === 'BYE') continue;

      const stage = getStageLabel(match.round, bracket.total_rounds);
      const stageOrder = getStageOrder(match.round);

      rows.push({
        categoryId: category.id,
        categoryLabel,
        categoryName: category.name,
        categoryGender: category.gender,
        categorySex: category.sex,
        categoryDiscipline: category.discipline,
        match,
        stage,
        stageOrder,
      });
    }
  }

  rows.sort((a, b) => {
    const prioA = getMatchPriority(a);
    const prioB = getMatchPriority(b);
    if (prioA !== prioB) return prioA - prioB;
    
    const wA = parseWeight(a.categoryName);
    const wB = parseWeight(b.categoryName);
    if (wA !== wB) return wA - wB;
    
    if (a.stageOrder !== b.stageOrder) return a.stageOrder - b.stageOrder;
    
    return a.match.position - b.match.position;
  });

  const schedule: ScheduleRow[] = rows.map((r, i) => ({ ...r, num: i + 1 }));

  const getFighterName = (match: BracketMatch, categoryId: string, isRed: boolean) => {
    const name = isRed ? match.fighter_red_name : match.fighter_blue_name;
    if (name) return name;

    if (match.round > 1) {
      const childPosition = isRed ? match.position * 2 : match.position * 2 + 1;
      const childId = `m-${categoryId}-r${match.round - 1}-p${childPosition}`;
      const childRow = schedule.find(r => r.match.id === childId);
      
      if (childRow) {
        return `Winner of #${childRow.num}`;
      }
    }
    
    return 'TBD';
  };

  const matchLabel = (row: ScheduleRow) => {
    const red = getFighterName(row.match, row.categoryId, true);
    const blue = getFighterName(row.match, row.categoryId, false);
    return (
      <div className="flex items-center whitespace-nowrap min-w-0 flex-1">
        <span className="text-red-400 font-bold truncate">{red}</span>
        <span className="text-zinc-600 font-bold text-xs mx-2 flex-shrink-0">vs</span>
        <span className="text-blue-400 font-bold truncate">{blue}</span>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-zinc-950 flex flex-col">
      <NavBar />
      {schedule.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center p-6">
          <div className="text-zinc-300 text-lg font-bold">No fights scheduled</div>
          <div className="text-zinc-500 text-sm">The schedule fills in once brackets are generated.</div>
        </div>
      ) : (
        <div className="max-w-6xl w-full mx-auto p-4">
          <div className="text-sm text-zinc-400 font-bold mb-3">
            {schedule.filter(r => r.match.status === 'COMPLETED').length} of {schedule.length} fights done
          </div>
          <div className="rounded-xl border border-zinc-800 overflow-hidden">
            <div className="grid grid-cols-[48px_1fr_2fr_120px_90px] gap-4 px-4 py-2.5 bg-zinc-900 text-[11px] font-bold text-zinc-500 uppercase tracking-widest">
              <div>#</div><div>Category</div><div>Fight</div><div>Stage</div><div>Status</div>
            </div>
            {schedule.map(row => {
              const isLive = row.match.id === tournament.active_match_bracket_match_id;
              const isDone = row.match.status === 'COMPLETED';
              const winner = row.match.winner_id === row.match.fighter_red_id ? row.match.fighter_red_name : row.match.fighter_blue_name;
              return (
                <div
                  key={row.match.id}
                  className={`grid grid-cols-[48px_1fr_2fr_120px_90px] gap-4 px-4 py-3 items-center border-t border-zinc-800/70 text-sm ${isLive ? 'bg-emerald-950/40' : isDone ? 'opacity-50' : ''}`}
                >
                  <div className="font-black text-zinc-500 tabular-nums">{row.num}</div>
                  <div className="min-w-0">
                    <div className="font-bold text-zinc-200 truncate">{row.categoryName} {row.categoryGender}</div>
                    <div className="text-[11px] text-zinc-500 uppercase">{row.categoryDiscipline}</div>
                  </div>
                  <div className="min-w-0 flex items-center gap-2">
                    {matchLabel(row)}
                    {isDone && winner && <span className="text-xs font-bold text-amber-400 truncate flex-shrink-0 max-w-40">won: {winner}</span>}
                  </div>
                  <div className="text-zinc-400 font-bold">{row.stage}</div>
                  <div className={`font-bold ${isLive ? 'text-emerald-400' : 'text-zinc-500'}`}>{isLive ? '● On ring' : isDone ? 'Done' : 'Waiting'}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
