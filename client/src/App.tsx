import { type ReactNode, useEffect, useState } from 'react'
import { BrowserRouter, Navigate, Routes, Route, useLocation } from 'react-router-dom'
import { type FightView, type TournamentState, emptyFight } from './api/protocol'
import { connect, sessionForPath, subscribeToState, subscribeToTournament } from './api/socket'
import OperatorScreen from './features/operator/OperatorScreen'
import JudgeScreen from './features/judge/JudgeScreen'
import JudgePicker from './features/judge/JudgePicker'
import ViewerScreen from './features/viewer/ViewerScreen'
import BoardScreen from './features/viewer/BoardScreen'
import BoardBrackets from './features/viewer/BoardBrackets'
import BracketSetup from './features/tournament/BracketSetup'
import BracketsPage from './features/tournament/BracketsPage'
import MatchSchedule from './features/tournament/MatchSchedule'
import BracketPrint from './features/tournament/BracketPrint'
import AdminLogin from './shared/AdminLogin'
import { useConnection } from './shared/useConnection'

const defaultTournament: TournamentState = {
  name: '',
  date: '',
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

/** The operator's pages need the admin login; judge, viewer and board pages don't. */
function AdminGate({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  const { session, status, sessionExpired } = useConnection()
  // Only the operator's own refusal locks the page, not the status a judge or
  // viewer page left behind just before this one's connection starts.
  if (sessionForPath(pathname).role === 'operator' && session.role === 'operator' && status === 'locked') {
    return <AdminLogin expired={sessionExpired} />
  }
  return <>{children}</>
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
      <AdminGate>
        <Routes>
          <Route path="/" element={<OperatorScreen view={state} tournament={tournament} />} />
          <Route path="/judge" element={<JudgePicker />} />
          <Route path="/judge/:id" element={<JudgeScreen view={state} />} />
          <Route path="/viewer" element={<ViewerScreen view={state} />} />
          <Route path="/board" element={<BoardScreen view={state} />} />
          <Route path="/board/brackets" element={<BoardBrackets tournament={tournament} />} />
          <Route path="/tournament/setup" element={<BracketSetup tournament={tournament} />} />
          <Route path="/tournament/brackets" element={<BracketsPage tournament={tournament} />} />
          <Route path="/tournament/brackets/all" element={<Navigate to="/tournament/brackets" replace />} />
          <Route path="/tournament/bracket/:categoryId" element={<BracketsPage tournament={tournament} />} />
          <Route path="/tournament/schedule" element={<MatchSchedule tournament={tournament} />} />
          <Route path="/tournament/print/:categoryId" element={<BracketPrint tournament={tournament} />} />
          {/* A mistyped address lands on the start screen, not a blank page. */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AdminGate>
    </BrowserRouter>
  )
}

export default App
