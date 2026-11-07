import type { ActionView, CornerView, FightView } from '../api/protocol';

/** Actions that decide the fight, and so name the winner: a stoppage, or the
 *  warning that disqualifies. */
const decides = (a: ActionView) => !a.undone && (a.type === 'Stoppage' || !!a.disqualifies);
/** Hidden before confirmation: the deciding action, and any stoppage at all,
 *  since an undone one still says who it named (e.g. KO undone, re-entered as RSC). */
const hidden = (a: ActionView) => decides(a) || a.type === 'Stoppage';

/**
 * The fight as a public screen may show it. The winner is shown only after
 * the operator confirms the result (§7), so until then this leaves out what
 * would name it: the action that decided the fight (and the warning it added
 * to the count) and each judge's verdict. Judges' scores stay (§7: WAKO open
 * scoring).
 */
export function publicView(view: FightView): FightView {
  if (view.result.confirmed) return view;
  const deciding = view.actions.filter(decides);
  const corners = { ...view.corners };
  for (const a of deciding) {
    if (a.type === 'OfficialWarning') corners[a.corner] = beforeDQWarning(corners[a.corner]);
  }
  return {
    ...view,
    corners,
    actions: view.actions.filter(a => !hidden(a)),
    judges: view.judges.map(j => ({ ...j, verdict: '', decided: false })),
  };
}

function beforeDQWarning(c: CornerView): CornerView {
  return { ...c, warnings: Math.max(c.warnings - 1, 0), next_warning_dq: true };
}
