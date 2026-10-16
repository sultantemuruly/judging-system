import { useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom'
import { type FightView, type TournamentState, emptyFight } from './api/protocol'
import { connect, sessionForPath, subscribeToState, subscribeToTournament } from './api/socket'
import OperatorScreen from './features/operator/OperatorScreen'
import JudgeScreen from './features/judge/JudgeScreen'
import ViewerScreen from './features/viewer/ViewerScreen'
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

function SessionSync() {
  const { pathname } = useLocation()
  useEffect(() => {
    connect(sessionForPath(pathname))
  }, [pathname])
  return null
}

function App() {
  const [state, setState] = useState<FightView>(emptyFight)
  const [tournament, setTournament] = useState<TournamentState>(defaultTournament)

  useEffect(() => {
    const unsub1 = subscribeToState(setState)
    const unsub2 = subscribeToTournament(setTournament)
    return () => { unsub1(); unsub2(); }
  }, [])

  return (
    <BrowserRouter>
      <SessionSync />
      <Routes>
        <Route path="/" element={<OperatorScreen view={state} tournament={tournament} />} />
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
