import { useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { type TournamentState, connectWebSocket, subscribeToState, subscribeToTournament } from './socket'
import { type FightView, emptyFight } from './api/protocol'
import Dashboard from './Dashboard'
import JudgeScreen from './JudgeScreen'
import ViewerScreen from './ViewerScreen'
import BracketSetup from './BracketSetup'
import BracketView from './BracketView'
import AllBracketsView from './AllBracketsView'
import MatchSchedule from './MatchSchedule'

const defaultTournament: TournamentState = {
  categories: [],
  brackets: {},
  active_match_category_id: '',
  active_match_bracket_match_id: '',
}

function App() {
  const [state, setState] = useState<FightView>(emptyFight)
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
        <Route path="/" element={<Dashboard view={state} tournament={tournament} />} />
        <Route path="/judge/:id" element={<JudgeScreen view={state} />} />
        <Route path="/viewer" element={<ViewerScreen view={state} />} />
        <Route path="/tournament/setup" element={<BracketSetup tournament={tournament} />} />
        <Route path="/tournament/bracket/:categoryId" element={<BracketView tournament={tournament} />} />
        <Route path="/tournament/brackets/all" element={<AllBracketsView tournament={tournament} />} />
        <Route path="/tournament/schedule" element={<MatchSchedule tournament={tournament} />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App

