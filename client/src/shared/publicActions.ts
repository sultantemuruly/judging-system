import type { ActionView, FightView } from '../api/protocol';

/** Actions that decide the fight, and so name the winner: a stoppage, or the
 *  warning that disqualifies. Undone ones decided nothing. */
const decides = (a: ActionView) => !a.undone && (a.type === 'Stoppage' || !!a.disqualifies);

/** The referee actions a public screen may show: the one that decided the
 *  fight stays hidden until the operator confirms the result (§7). */
export function publicActions(view: FightView): ActionView[] {
  if (view.result.confirmed) return view.actions;
  return view.actions.filter(a => !decides(a));
}
