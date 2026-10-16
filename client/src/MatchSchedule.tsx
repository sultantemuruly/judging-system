import { useNavigate } from 'react-router-dom';
import type { TournamentState, BracketMatch } from './api/protocol';
import { ArrowLeft, CalendarDays, Zap, List } from 'lucide-react';

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
  const navigate = useNavigate();

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
        return `Победитель боя #${childRow.num}`;
      }
    }
    
    return 'TBD';
  };

  const matchLabel = (row: ScheduleRow) => {
    const red = getFighterName(row.match, row.categoryId, true);
    const blue = getFighterName(row.match, row.categoryId, false);
    return (
      <div className="flex items-center whitespace-nowrap min-w-0 flex-1">
        <span className="text-red-600 truncate">{red}</span>
        <span className="text-zinc-400 font-bold text-xs mx-1.5 flex-shrink-0 uppercase">vs</span>
        <span className="text-blue-600 truncate">{blue}</span>
      </div>
    );
  };

  return (
    <div className="bg-white rounded-xl border border-zinc-200 shadow-xl overflow-hidden flex flex-col h-[calc(100vh-140px)]">
      {/* Header */}
      <div className="bg-zinc-50 border-b border-zinc-200 p-4 shrink-0 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-indigo-100 rounded-lg">
            <List size={20} className="text-indigo-600" />
          </div>
          <div>
            <h2 className="text-lg font-black text-zinc-900 uppercase tracking-wider">Tournament Schedule</h2>
            <p className="text-xs font-bold text-zinc-500 uppercase tracking-widest">
              {schedule.filter(r => r.match.status === 'COMPLETED').length} of {schedule.length} matches completed
            </p>
          </div>
        </div>
        <button
          onClick={() => navigate('/tournament/setup')}
          className="p-2 bg-zinc-100 hover:bg-zinc-200 text-zinc-600 rounded-lg transition-all cursor-pointer"
        >
          <ArrowLeft size={18} />
        </button>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto min-h-0 custom-scrollbar relative">
        {schedule.length === 0 ? (
          <div className="flex items-center justify-center py-20 text-center">
            <div>
              <CalendarDays size={48} className="text-zinc-400 mx-auto mb-4" />
              <div className="text-zinc-700 text-lg font-bold">No matches scheduled</div>
              <div className="text-zinc-500 text-sm mt-1">
                Generate brackets in the setup page first.
              </div>
            </div>
          </div>
        ) : (
          <div className="rounded-2xl border border-zinc-200 m-4 overflow-hidden shadow-sm">
            {/* Table header */}
            <div className="grid grid-cols-[52px_1fr_2fr_140px_100px] bg-zinc-100 border-b border-zinc-200 px-4 py-3 gap-4">
              <div className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">#</div>
              <div className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Category</div>
              <div className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Match</div>
              <div className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Stage</div>
              <div className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Status</div>
            </div>

            {/* Rows */}
            {schedule.map((row, idx) => {
              const isLive = row.match.id === tournament.active_match_bracket_match_id;
              const isDone = row.match.status === 'COMPLETED';
              const isEven = idx % 2 === 0;

              return (
                <div 
                  key={row.match.id}
                  className={`grid grid-cols-[52px_1fr_2fr_140px_100px] px-4 py-3.5 gap-4 items-center border-b border-zinc-200/50 last:border-b-0 transition-all ${
                    isLive
                      ? 'bg-blue-50 border-l-4 border-l-blue-500 shadow-sm'
                      : isDone
                      ? 'opacity-60 bg-zinc-50/50'
                      : isEven
                      ? 'bg-zinc-50/80 hover:bg-zinc-100'
                      : 'bg-white hover:bg-zinc-100'
                  }`}
                >
                  {/* # */}
                  <div className={`text-sm font-black tabular-nums ${isLive ? 'text-blue-600' : 'text-zinc-500'}`}>
                    {row.num}
                  </div>

                  {/* Category */}
                  <div>
                    <div className={`text-sm font-bold truncate ${isLive ? 'text-zinc-900' : 'text-zinc-700'}`}>
                      {row.categoryName} {row.categoryGender}
                    </div>
                    <div className="text-[10px] font-black tracking-widest uppercase text-zinc-400 mt-0.5">
                      {row.categoryDiscipline}
                    </div>
                  </div>

                  {/* Match */}
                  <div className={`flex items-center min-w-0 ${isLive ? 'text-zinc-900' : isDone ? 'text-zinc-500' : 'text-zinc-800'}`}>
                    {matchLabel(row)}
                    {isDone && row.match.winner_id && (
                      <span className="ml-2 text-[10px] font-bold text-amber-600 bg-amber-100 px-2 py-0.5 rounded-full flex-shrink-0 truncate max-w-[120px]">
                        ✓ {row.match.winner_id === row.match.fighter_red_id ? row.match.fighter_red_name : row.match.fighter_blue_name}
                      </span>
                    )}
                  </div>

                  {/* Stage */}
                  <div>
                    <span className={`inline-block text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-lg ${
                      row.stage === 'Final'
                        ? 'text-amber-700 bg-amber-100 border border-amber-200'
                        : row.stage === 'Semi-Final'
                        ? 'text-violet-700 bg-violet-100 border border-violet-200'
                        : row.stage === 'Quarter-Final'
                        ? 'text-blue-700 bg-blue-100 border border-blue-200'
                        : 'text-zinc-600 bg-zinc-100 border border-zinc-200'
                    }`}>
                      {row.stage}
                    </span>
                  </div>

                  {/* Status */}
                  <div>
                    {isLive ? (
                      <span className="inline-flex items-center gap-1.5 text-[10px] font-bold text-emerald-600 bg-emerald-100 border border-emerald-200 px-2.5 py-1 rounded-lg animate-pulse">
                        <Zap size={10} /> LIVE
                      </span>
                    ) : isDone ? (
                      <span className="inline-block text-[10px] font-bold text-zinc-500 bg-zinc-100 border border-zinc-200 px-2.5 py-1 rounded-lg">
                        Done
                      </span>
                    ) : (
                      <span className="inline-block text-[10px] font-bold text-zinc-500 bg-zinc-100 border border-zinc-200 px-2.5 py-1 rounded-lg">
                        Pending
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
