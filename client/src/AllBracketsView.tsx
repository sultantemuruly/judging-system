import { useNavigate } from 'react-router-dom';
import type { TournamentState } from './api/protocol';
import { sendAction } from './api/socket';
import { ArrowLeft, LayoutGrid, Trophy } from 'lucide-react';
import { SymmetricBracketTree } from './BracketView';

interface Props {
  tournament: TournamentState;
}

export default function AllBracketsView({ tournament }: Props) {
  const navigate = useNavigate();

  const generatedCategories = tournament.categories.filter(
    cat => tournament.brackets?.[cat.id]?.generated
  );

  return (
    <div className="min-h-screen bg-zinc-950">
      {/* Header */}
      <div className="sticky top-0 z-20 bg-zinc-950/95 backdrop-blur-sm border-b border-zinc-800">
        <div className="flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate('/tournament/setup')}
              className="p-2 bg-zinc-800 hover:bg-zinc-700 text-white rounded-lg transition-all cursor-pointer"
            >
              <ArrowLeft size={18} />
            </button>
            <div>
              <h1 className="text-2xl font-black text-white tracking-wider uppercase flex items-center gap-2">
                <LayoutGrid size={22} className="text-emerald-400" />
                All Brackets
              </h1>
              <p className="text-xs text-zinc-500 font-medium mt-0.5">
                {generatedCategories.length} categor{generatedCategories.length === 1 ? 'y' : 'ies'} · scroll to view all
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      {generatedCategories.length === 0 ? (
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="text-center">
            <Trophy size={48} className="text-zinc-700 mx-auto mb-4" />
            <div className="text-zinc-500 text-lg font-bold">No brackets generated yet</div>
            <div className="text-zinc-600 text-sm mt-1 mb-6">
              Go to setup, add fighters, and generate brackets first.
            </div>
            <button
              onClick={() => navigate('/tournament/setup')}
              className="px-5 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-white text-sm font-bold rounded-xl transition-all flex items-center gap-2 mx-auto cursor-pointer"
            >
              <ArrowLeft size={16} /> Back to Setup
            </button>
          </div>
        </div>
      ) : (
        <div className="divide-y divide-zinc-800/60">
          {generatedCategories.map((category, idx) => {
            const bracket = tournament.brackets[category.id];
            const hues = [
              'from-emerald-900/20 border-emerald-700/30',
              'from-blue-900/20 border-blue-700/30',
              'from-violet-900/20 border-violet-700/30',
              'from-amber-900/20 border-amber-700/30',
              'from-rose-900/20 border-rose-700/30',
              'from-cyan-900/20 border-cyan-700/30',
            ];
            const accent = hues[idx % hues.length];

            return (
              <section key={category.id} className="py-8 px-6">
                {/* Category Header */}
                <div className={`inline-flex items-center gap-3 mb-6 px-5 py-3 rounded-2xl bg-gradient-to-r ${accent} border`}>
                  <div>
                    <h2 className="text-xl font-black text-white tracking-wide">
                      {category.name}
                    </h2>
                    <div className="text-xs text-zinc-400 font-medium mt-0.5 uppercase tracking-widest">
                      {[category.gender, category.discipline].filter(Boolean).join(' · ')}
                      {' · '}{category.fighters?.length || 0} fighters
                    </div>
                  </div>
                  <button
                    onClick={() => navigate(`/tournament/bracket/${category.id}`)}
                    className="ml-2 px-3 py-1.5 bg-zinc-800/80 hover:bg-zinc-700 text-zinc-300 text-xs font-bold rounded-lg transition-all border border-zinc-700 cursor-pointer whitespace-nowrap"
                  >
                    View Alone →
                  </button>
                  <button
                    onClick={() => {
                      if (window.confirm('Are you sure you want to regenerate this bracket? All current matches and results will be lost.')) {
                        sendAction('GENERATE_BRACKET', { category_id: category.id });
                      }
                    }}
                    className="px-3 py-1.5 bg-zinc-800/80 hover:bg-zinc-700 text-zinc-400 text-xs font-bold rounded-lg transition-all border border-zinc-700 cursor-pointer whitespace-nowrap"
                  >
                    ↺ Regen
                  </button>
                </div>

                {/* Bracket Tree */}
                <SymmetricBracketTree
                  bracket={bracket}
                  category={category}
                  activeBracketMatchId={tournament.active_match_bracket_match_id}
                  onStartMatch={(matchId) => {
                    sendAction('START_BRACKET_MATCH', { category_id: category.id, match_id: matchId });
                    navigate('/');
                  }}
                  onSetWinner={(matchId, winnerId) =>
                    sendAction('SET_MATCH_WINNER', { category_id: category.id, match_id: matchId, winner_id: winnerId })
                  }
                />
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
