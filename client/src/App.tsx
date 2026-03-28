import { useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { type MatchState, type TournamentState, connectWebSocket, subscribeToState, subscribeToTournament } from './socket'
import Dashboard from './Dashboard'
import JudgeScreen from './JudgeScreen'
import ViewerScreen from './ViewerScreen'
import BracketSetup from './BracketSetup'
import BracketView from './BracketView'
import AllBracketsView from './AllBracketsView'
import MatchSchedule from './MatchSchedule'

const defaultState: MatchState = {
  match_id: '',
  current_round: 0,
  rounds: [],
  match_winner: null,
  match_result: '',
  official_warnings: { Red: 0, Blue: 0 },
  warning_penalties: { Red: 0, Blue: 0 },
  warning_history: [],
  disqualified: null,
  fight_ended: false,
  red_fighter_name: '',
  blue_fighter_name: '',
  category_name: '',
  rest_end_time: null,
  round_duration: 0,
  rest_duration: 0
}

const defaultTournament: TournamentState = {
  categories: [],
  brackets: {},
  active_match_category_id: '',
  active_match_bracket_match_id: '',
}

function App() {
  const [state, setState] = useState<MatchState>(defaultState)
  const [tournament, setTournament] = useState<TournamentState>(defaultTournament)

  useEffect(() => {
    connectWebSocket()
    const unsub1 = subscribeToState((newState) => {
      setState(newState)
    })
    const unsub2 = subscribeToTournament((newState) => {
      setTournament(newState)
    })
    return () => { unsub1(); unsub2(); }
  }, [])

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Dashboard state={state} tournament={tournament} />} />
        <Route path="/judge/:id" element={<JudgeScreen state={state} />} />
        <Route path="/viewer" element={<ViewerScreen state={state} />} />
        <Route path="/tournament/setup" element={<BracketSetup tournament={tournament} />} />
        <Route path="/tournament/bracket/:categoryId" element={<BracketView tournament={tournament} />} />
        <Route path="/tournament/brackets/all" element={<AllBracketsView tournament={tournament} />} />
        <Route path="/tournament/schedule" element={<MatchSchedule tournament={tournament} />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App

