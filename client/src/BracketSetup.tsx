import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { type TournamentState, type TournamentFighter, type WeightCategory, type FightFormat, defaultFormat, sendAction } from './socket';
import { Plus, Trash2, Edit3, Trophy, Medal, Users, ChevronRight, Swords, X, Check, LayoutGrid, CalendarDays } from 'lucide-react';

interface Props {
  tournament: TournamentState;
}

export default function BracketSetup({ tournament }: Props) {
  const navigate = useNavigate();
  const [selectedCatId, setSelectedCatId] = useState<string | null>(null);

  // Category form state
  const [catName, setCatName] = useState('');
  const [catGender, setCatGender] = useState('Seniors');
  const [catSex, setCatSex] = useState('male');
  const [catDiscipline, setCatDiscipline] = useState('k-1');
  const [catFormat, setCatFormat] = useState<FightFormat>(defaultFormat);
  const [editingCatId, setEditingCatId] = useState<string | null>(null);

  // Fighter form state
  const [fighterName, setFighterName] = useState('');
  const [fighterCity, setFighterCity] = useState('');
  const [fighterClub, setFighterClub] = useState('');
  const [isChampion, setIsChampion] = useState(false);
  const [isSecond, setIsSecond] = useState(false);
  const [editingFighterId, setEditingFighterId] = useState<string | null>(null);

  // Generate Bracket Modal state
  const [showGenerateModal, setShowGenerateModal] = useState(false);
  const [seedMode, setSeedMode] = useState<'random' | 'manual'>('random');
  const [manualSeedSlots, setManualSeedSlots] = useState<(string | null)[]>([]);

  const selectedCategory = tournament.categories.find(c => c.id === selectedCatId);
  const bracket = selectedCatId ? tournament.brackets?.[selectedCatId] : null;

  const nextPowerOf2 = (n: number) => {
    if (n <= 1) return 1;
    let p = 1;
    while (p < n) p *= 2;
    return p;
  };

  const bracketSize = selectedCategory?.fighters ? nextPowerOf2(selectedCategory.fighters.length) : 0;

  const handleAddCategory = () => {
    if (!catName.trim()) return;
    if (editingCatId) {
      sendAction('EDIT_CATEGORY', { category_id: editingCatId, name: catName.trim(), gender: catGender, sex: catSex, discipline: catDiscipline, ...catFormat });
      setEditingCatId(null);
    } else {
      sendAction('ADD_CATEGORY', { name: catName.trim(), gender: catGender, sex: catSex, discipline: catDiscipline, ...catFormat });
    }
    resetCategoryForm();
  };

  const resetCategoryForm = () => {
    setEditingCatId(null);
    setCatName('');
    setCatGender('Seniors');
    setCatSex('male');
    setCatDiscipline('k-1');
    setCatFormat(defaultFormat);
  };

  const setFormatField = (field: keyof FightFormat, value: number) =>
    setCatFormat(f => ({ ...f, [field]: value }));

  const handleDeleteCategory = (id: string) => {
    sendAction('DELETE_CATEGORY', { category_id: id });
    if (selectedCatId === id) setSelectedCatId(null);
  };

  const handleEditCategory = (cat: WeightCategory) => {
    setEditingCatId(cat.id);
    setCatName(cat.name);
    setCatGender(cat.gender);
    setCatSex(cat.sex || 'male');
    setCatDiscipline(cat.discipline || 'k-1');
    setCatFormat(cat.format ?? defaultFormat);
  };

  const handleAddFighter = () => {
    if (!fighterName.trim() || !selectedCatId) return;
    const fighter: Partial<TournamentFighter> = {
      name: fighterName.trim(),
      city: fighterCity.trim(),
      club: fighterClub.trim(),
      is_previous_champion: isChampion,
      is_previous_second: isSecond,
    };

    if (editingFighterId) {
      sendAction('EDIT_FIGHTER', { category_id: selectedCatId, fighter_id: editingFighterId, fighter });
      setEditingFighterId(null);
    } else {
      sendAction('ADD_FIGHTER', { category_id: selectedCatId, fighter });
    }
    resetFighterForm();
  };

  const resetFighterForm = () => {
    setFighterName('');
    setFighterCity('');
    setFighterClub('');
    setIsChampion(false);
    setIsSecond(false);
    setEditingFighterId(null);
  };

  const handleEditFighter = (f: TournamentFighter) => {
    setEditingFighterId(f.id);
    setFighterName(f.name);
    setFighterCity(f.city);
    setFighterClub(f.club);
    setIsChampion(f.is_previous_champion);
    setIsSecond(f.is_previous_second);
  };

  const handleDeleteFighter = (fighterId: string) => {
    if (!selectedCatId) return;
    sendAction('DELETE_FIGHTER', { category_id: selectedCatId, fighter_id: fighterId });
  };

  const handleGenerateBracket = () => {
    if (!selectedCatId) return;
    if (bracket?.generated) {
      if (!window.confirm('Are you sure you want to regenerate this bracket? All current matches and results will be lost.')) return;
    }
    setSeedMode('random');
    if (bracketSize > 0) setManualSeedSlots(Array(bracketSize).fill(null));
    setShowGenerateModal(true);
  };

  const handleConfirmGenerate = () => {
    if (!selectedCatId) return;
    const payload: { category_id: string; manual_seeding?: string[] } = { category_id: selectedCatId };
    if (seedMode === 'manual') {
      payload.manual_seeding = manualSeedSlots.map(s => s || "");
    }
    sendAction('GENERATE_BRACKET', payload);
    setShowGenerateModal(false);
  };

  return (
    <div className="min-h-screen bg-zinc-950 flex">
      
      {/* Left Panel — Categories */}
      <div className="w-80 border-r border-zinc-800 flex flex-col bg-zinc-900/50">
        <div className="p-5 border-b border-zinc-800">
          <h1 className="text-xl font-black text-white tracking-widest uppercase mb-1">
            Tournament
          </h1>
          <p className="text-xs text-zinc-500 font-medium mb-3">Weight Categories</p>
          <div className="flex flex-col gap-2">
            <button
              onClick={() => navigate('/tournament/brackets/all')}
              className="w-full px-3 py-2 bg-emerald-900/30 hover:bg-emerald-900/50 border border-emerald-700/30 text-emerald-300 text-xs font-bold rounded-lg transition-all flex items-center gap-2 cursor-pointer"
            >
              <LayoutGrid size={13} /> View All Brackets
            </button>
            <button
              onClick={() => navigate('/tournament/schedule')}
              className="w-full px-3 py-2 bg-blue-900/30 hover:bg-blue-900/50 border border-blue-700/30 text-blue-300 text-xs font-bold rounded-lg transition-all flex items-center gap-2 cursor-pointer"
            >
              <CalendarDays size={13} /> Match Schedule
            </button>
          </div>
        </div>

        {/* Add/Edit Category Form */}
        <div className="p-4 border-b border-zinc-800 space-y-3">
          <input
            type="text"
            placeholder="Category name (e.g. 65kg)"
            value={catName}
            onChange={e => setCatName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAddCategory()}
            className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-white text-sm placeholder-zinc-500 focus:outline-none focus:border-zinc-500"
          />
          <div className="flex gap-2 flex-wrap">
            <select
              value={catSex}
              onChange={e => setCatSex(e.target.value)}
              className="flex-1 min-w-[90px] px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-white text-sm focus:outline-none focus:border-zinc-500"
            >
              <option value="male">Male</option>
              <option value="female">Female</option>
            </select>
            <select
              value={catGender}
              onChange={e => setCatGender(e.target.value)}
              className="flex-1 min-w-[90px] px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-white text-sm focus:outline-none focus:border-zinc-500"
            >
              <option value="Seniors">Seniors</option>
              <option value="2012-2013">2012-2013</option>
              <option value="2010-2011">2010-2011</option>
            </select>
            <select
              value={catDiscipline}
              onChange={e => setCatDiscipline(e.target.value)}
              className="flex-1 min-w-[110px] px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-white text-sm focus:outline-none focus:border-zinc-500"
            >
              <option value="low-kick">Low-Kick</option>
              <option value="full-contact">Full Contact</option>
              <option value="k-1">K-1</option>
            </select>
          </div>
          {/* Fight format (§2) and knockdown limits (§5) */}
          <div className="grid grid-cols-3 gap-2 text-[10px] font-bold text-zinc-500 uppercase tracking-wider">
            <label className="flex flex-col gap-1">Rounds
              <select value={catFormat.rounds} onChange={e => setFormatField('rounds', Number(e.target.value))}
                className="px-2 py-1.5 bg-zinc-800 border border-zinc-700 rounded-lg text-white text-sm normal-case">
                {[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1">Round
              <select value={catFormat.round_seconds} onChange={e => setFormatField('round_seconds', Number(e.target.value))}
                className="px-2 py-1.5 bg-zinc-800 border border-zinc-700 rounded-lg text-white text-sm normal-case">
                {[60, 90, 120, 150, 180].map(n => <option key={n} value={n}>{Math.floor(n / 60)}:{String(n % 60).padStart(2, '0')}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1">Rest
              <select value={catFormat.rest_seconds} onChange={e => setFormatField('rest_seconds', Number(e.target.value))}
                className="px-2 py-1.5 bg-zinc-800 border border-zinc-700 rounded-lg text-white text-sm normal-case">
                {[30, 45, 60, 90, 120].map(n => <option key={n} value={n}>{Math.floor(n / 60)}:{String(n % 60).padStart(2, '0')}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1 col-span-3 sm:col-span-1">KD / round
              <input type="number" min={1} max={9} value={catFormat.kd_limit_round} onChange={e => setFormatField('kd_limit_round', Number(e.target.value))}
                className="px-2 py-1.5 bg-zinc-800 border border-zinc-700 rounded-lg text-white text-sm" />
            </label>
            <label className="flex flex-col gap-1 col-span-3 sm:col-span-1">KD / fight
              <input type="number" min={1} max={9} value={catFormat.kd_limit_fight} onChange={e => setFormatField('kd_limit_fight', Number(e.target.value))}
                className="px-2 py-1.5 bg-zinc-800 border border-zinc-700 rounded-lg text-white text-sm" />
            </label>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleAddCategory}
              className="flex-1 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold rounded-lg transition-all flex items-center justify-center gap-1 cursor-pointer"
            >
              {editingCatId ? <Check size={14} /> : <Plus size={14} />}
              {editingCatId ? 'Save' : 'Add'}
            </button>
            {editingCatId && (
              <button
                onClick={resetCategoryForm}
                className="p-2 bg-zinc-700 hover:bg-zinc-600 text-white rounded-lg transition-all cursor-pointer"
              >
                <X size={14} />
              </button>
            )}
          </div>
        </div>

        {/* Category List */}
        <div className="flex-1 overflow-y-auto">
          {tournament.categories.length === 0 && (
            <div className="text-center text-zinc-600 text-sm py-12 px-4">
              No categories yet. Add one above.
            </div>
          )}
          {tournament.categories.map(cat => (
            <div
              key={cat.id}
              className={`flex items-center gap-3 px-4 py-3 border-b border-zinc-800/50 cursor-pointer transition-all ${
                selectedCatId === cat.id 
                  ? 'bg-zinc-800/80 border-l-2 border-l-emerald-500' 
                  : 'hover:bg-zinc-800/40 border-l-2 border-l-transparent'
              }`}
              onClick={() => setSelectedCatId(cat.id)}
            >
              <div className="flex-1 min-w-0">
                <div className="text-white font-bold text-sm truncate">{cat.name}</div>
                <div className="text-zinc-500 text-xs">{[cat.sex, cat.gender, cat.discipline].filter(Boolean).join(' · ')} · {cat.fighters?.length || 0} fighters</div>
                {cat.format && (
                  <div className="text-zinc-600 text-[10px]">{cat.format.rounds}×{Math.floor(cat.format.round_seconds / 60)}:{String(cat.format.round_seconds % 60).padStart(2, '0')} · KD {cat.format.kd_limit_round}/{cat.format.kd_limit_fight}</div>
                )}
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); handleEditCategory(cat); }}
                className="p-1.5 text-zinc-500 hover:text-zinc-300 transition-colors cursor-pointer"
              >
                <Edit3 size={13} />
              </button>
              <button 
                onClick={(e) => { e.stopPropagation(); handleDeleteCategory(cat.id); }}
                className="p-1.5 text-zinc-500 hover:text-red-400 transition-colors cursor-pointer"
              >
                <Trash2 size={13} />
              </button>
              <ChevronRight size={14} className="text-zinc-600" />
            </div>
          ))}
        </div>
      </div>

      {/* Center/Right Panel — Fighter List + Form */}
      <div className="flex-1 flex flex-col">
        {!selectedCategory ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <Users size={48} className="text-zinc-700 mx-auto mb-4" />
              <div className="text-zinc-500 text-lg font-bold">Select a category</div>
              <div className="text-zinc-600 text-sm mt-1">Choose or create a weight category to manage fighters</div>
            </div>
          </div>
        ) : (
          <>
            {/* Category Header */}
            <div className="p-5 border-b border-zinc-800 flex items-center justify-between">
              <div>
                <h2 className="text-2xl font-black text-white">{selectedCategory.name}</h2>
                <div className="text-zinc-500 text-sm font-medium mt-0.5">{[selectedCategory.sex, selectedCategory.gender, selectedCategory.discipline].filter(Boolean).join(' · ')} · {selectedCategory.fighters?.length || 0} fighters</div>
              </div>
              <div className="flex gap-3">
                {bracket?.generated && (
                  <button
                    onClick={() => navigate(`/tournament/bracket/${selectedCatId}`)}
                    className="px-5 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-white text-sm font-bold rounded-xl transition-all flex items-center gap-2 border border-zinc-700 cursor-pointer"
                  >
                    <Swords size={16} />
                    View Bracket
                  </button>
                )}
                <button
                  onClick={handleGenerateBracket}
                  disabled={!selectedCategory.fighters || selectedCategory.fighters.length < 2}
                  className="px-5 py-2.5 bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 disabled:opacity-30 text-white text-sm font-bold rounded-xl transition-all flex items-center gap-2 cursor-pointer shadow-lg shadow-amber-900/20"
                >
                  <Swords size={16} />
                  {bracket?.generated ? 'Regenerate Bracket' : 'Generate Bracket'}
                </button>
              </div>
            </div>

            {/* Add Fighter Form */}
            <div className="p-5 border-b border-zinc-800 bg-zinc-900/30">
              <div className="flex items-center gap-2 mb-3">
                <Plus size={14} className="text-zinc-500" />
                <span className="text-xs font-bold text-zinc-500 uppercase tracking-widest">
                  {editingFighterId ? 'Edit Fighter' : 'Add Fighter'}
                </span>
              </div>
              <div className="flex gap-3 items-end flex-wrap">
                <div className="flex-1 min-w-[180px]">
                  <label className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider mb-1 block">Name *</label>
                  <input
                    type="text"
                    placeholder="Fighter name"
                    value={fighterName}
                    onChange={e => setFighterName(e.target.value)}
                    className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-white text-sm placeholder-zinc-500 focus:outline-none focus:border-zinc-500"
                  />
                </div>
                <div className="flex-1 min-w-[140px]">
                  <label className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider mb-1 block">City</label>
                  <input
                    type="text"
                    placeholder="City"
                    value={fighterCity}
                    onChange={e => setFighterCity(e.target.value)}
                    className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-white text-sm placeholder-zinc-500 focus:outline-none focus:border-zinc-500"
                  />
                </div>
                <div className="flex-1 min-w-[140px]">
                  <label className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider mb-1 block">Club</label>
                  <input
                    type="text"
                    placeholder="Club name"
                    value={fighterClub}
                    onChange={e => setFighterClub(e.target.value)}
                    className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-white text-sm placeholder-zinc-500 focus:outline-none focus:border-zinc-500"
                  />
                </div>
                <div className="flex items-center gap-4">
                  <label className="flex items-center gap-2 cursor-pointer group">
                    <input
                      type="checkbox"
                      checked={isChampion}
                      onChange={e => { setIsChampion(e.target.checked); if (e.target.checked) setIsSecond(false); }}
                      className="accent-amber-500 w-4 h-4"
                    />
                    <span className="flex items-center gap-1 text-xs font-bold text-amber-500/80 group-hover:text-amber-400 transition-colors">
                      <Trophy size={12} /> Champion
                    </span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer group">
                    <input
                      type="checkbox"
                      checked={isSecond}
                      onChange={e => { setIsSecond(e.target.checked); if (e.target.checked) setIsChampion(false); }}
                      className="accent-zinc-400 w-4 h-4"
                    />
                    <span className="flex items-center gap-1 text-xs font-bold text-zinc-400/80 group-hover:text-zinc-300 transition-colors">
                      <Medal size={12} /> 2nd Place
                    </span>
                  </label>
                </div>
                <button
                  onClick={handleAddFighter}
                  disabled={!fighterName.trim()}
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-30 text-white text-sm font-bold rounded-lg transition-all flex items-center gap-1 cursor-pointer"
                >
                  {editingFighterId ? <Check size={14} /> : <Plus size={14} />}
                  {editingFighterId ? 'Save' : 'Add'}
                </button>
                {editingFighterId && (
                  <button
                    onClick={resetFighterForm}
                    className="p-2 bg-zinc-700 hover:bg-zinc-600 text-white rounded-lg transition-all cursor-pointer"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
            </div>

            {/* Fighter List */}
            <div className="flex-1 overflow-y-auto">
              {(!selectedCategory.fighters || selectedCategory.fighters.length === 0) ? (
                <div className="text-center text-zinc-600 text-sm py-16">
                  No fighters yet. Add fighters using the form above.
                </div>
              ) : (
                <div className="divide-y divide-zinc-800/50">
                  {selectedCategory.fighters.map((f, idx) => (
                    <div key={f.id} className="flex items-center gap-4 px-5 py-3 hover:bg-zinc-900/40 transition-colors group">
                      <div className="w-8 h-8 rounded-full bg-zinc-800 flex items-center justify-center text-zinc-500 text-sm font-bold flex-shrink-0">
                        {idx + 1}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-white font-bold text-sm">{f.name}</span>
                          {f.is_previous_champion && (
                            <span className="flex items-center gap-1 text-[10px] font-bold text-amber-500 bg-amber-500/10 px-2 py-0.5 rounded-full">
                              <Trophy size={10} /> CHAMPION
                            </span>
                          )}
                          {f.is_previous_second && (
                            <span className="flex items-center gap-1 text-[10px] font-bold text-zinc-400 bg-zinc-400/10 px-2 py-0.5 rounded-full">
                              <Medal size={10} /> 2ND PLACE
                            </span>
                          )}
                        </div>
                        <div className="text-zinc-500 text-xs mt-0.5">
                          {[f.city, f.club].filter(Boolean).join(' · ') || 'No city/club'}
                        </div>
                      </div>
                      <button
                        onClick={() => handleEditFighter(f)}
                        className="p-1.5 text-zinc-600 hover:text-zinc-300 transition-colors opacity-0 group-hover:opacity-100 cursor-pointer"
                      >
                        <Edit3 size={14} />
                      </button>
                      <button
                        onClick={() => handleDeleteFighter(f.id)}
                        className="p-1.5 text-zinc-600 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100 cursor-pointer"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Generate Bracket Modal */}
      {showGenerateModal && selectedCategory && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-700 rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl">
            {/* Header */}
            <div className="p-6 border-b border-zinc-800 flex justify-between items-center bg-zinc-950/50 rounded-t-2xl flex-shrink-0">
              <div>
                <h2 className="text-xl font-black text-white flex items-center gap-2">
                  <Swords size={20} className="text-emerald-500" />
                  Generate Bracket
                </h2>
                <div className="text-zinc-500 text-sm mt-1">Configure seeding options for {selectedCategory.name}</div>
              </div>
              <button 
                onClick={() => setShowGenerateModal(false)}
                className="text-zinc-500 hover:text-white transition-colors cursor-pointer"
              >
                <X size={24} />
              </button>
            </div>

            {/* Body */}
            <div className="p-6 overflow-y-auto min-h-0 flex-1">
              <div className="mb-6">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-bold text-white">Seeding Method</label>
                </div>
                <div className="flex bg-zinc-950 rounded-xl p-1 border border-zinc-800 shadow-inner">
                  <button
                    onClick={() => setSeedMode('random')}
                    className={`flex-1 py-2.5 rounded-lg text-sm font-bold transition-all cursor-pointer ${
                      seedMode === 'random' ? 'bg-zinc-800 text-white shadow-md border border-zinc-700' : 'text-zinc-500 hover:text-zinc-300'
                    }`}
                  >
                    Random (Separated)
                  </button>
                  <button
                    onClick={() => setSeedMode('manual')}
                    className={`flex-1 py-2.5 rounded-lg text-sm font-bold transition-all cursor-pointer ${
                      seedMode === 'manual' ? 'bg-zinc-800 text-white shadow-md border border-zinc-700' : 'text-zinc-500 hover:text-zinc-300'
                    }`}
                  >
                    Manual Assignment
                  </button>
                </div>
                {seedMode === 'random' && (
                  <p className="text-xs text-zinc-500 mt-3 text-center">
                    Automatically seeds fighters. Champions and 2nd place are opposed. Members from the same club or city are separated as much as possible.
                  </p>
                )}
              </div>

              {seedMode === 'manual' && (
                <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-bold text-white">Starting Slots ({bracketSize})</h3>
                    <div className="text-xs font-bold text-amber-500 bg-amber-500/10 px-2 py-1 rounded-md">
                      Placing {manualSeedSlots.filter(Boolean).length} of {selectedCategory.fighters?.length || 0} fighters
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {Array.from({ length: bracketSize }).map((_, i) => (
                      <div key={i} className="bg-zinc-950 p-3 rounded-xl border border-zinc-800 flex items-center gap-3">
                        <div className="w-6 h-6 rounded-md bg-zinc-900 border border-zinc-800 flex items-center justify-center text-[10px] font-black text-zinc-600 flex-shrink-0">
                          {i + 1}
                        </div>
                        <select
                          value={manualSeedSlots[i] || ''}
                          onChange={(e) => {
                            const newSlots = [...manualSeedSlots];
                            newSlots[i] = e.target.value || null;
                            setManualSeedSlots(newSlots);
                          }}
                          className="flex-1 bg-zinc-900 border border-zinc-700/50 rounded-lg text-white text-sm px-3 py-2 outline-none focus:border-amber-500 focus:bg-zinc-800 transition-all shadow-sm"
                        >
                          <option value="">-- BYE (Empty) --</option>
                          {selectedCategory.fighters?.map(f => {
                            const isSelectedElsewhere = manualSeedSlots.some((id, idx) => id === f.id && idx !== i);
                            return (
                              <option key={f.id} value={f.id} disabled={isSelectedElsewhere}>
                                {f.name} {f.club ? `(${f.club})` : ''}
                              </option>
                            );
                          })}
                        </select>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="p-6 border-t border-zinc-800 flex justify-end gap-3 bg-zinc-950/50 rounded-b-2xl flex-shrink-0">
              <button
                onClick={() => setShowGenerateModal(false)}
                className="px-5 py-2.5 bg-zinc-800 text-zinc-300 rounded-xl font-bold hover:bg-zinc-700 transition-all cursor-pointer"
              >
                Cancel
              </button>
              <button
                disabled={seedMode === 'manual' && (selectedCategory.fighters?.some(f => !manualSeedSlots.includes(f.id)) ?? false)}
                onClick={handleConfirmGenerate}
                className="px-6 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 text-white rounded-xl font-bold hover:from-emerald-500 hover:to-teal-500 disabled:opacity-30 disabled:grayscale transition-all flex items-center gap-2 cursor-pointer shadow-lg shadow-emerald-900/20"
              >
                <Check size={16} />
                Confirm & Generate
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
