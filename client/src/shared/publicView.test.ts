import { describe, expect, it } from 'vitest';
import { emptyFight, type ActionView, type FightView } from '../api/protocol';
import { publicView } from './publicView';

const action = (id: string, type: ActionView['type'], extra: Partial<ActionView> = {}): ActionView =>
  ({ id, type, corner: 'Blue', round: 1, at: 0, undone: false, ...extra });

const judges = [1, 2, 3].map(seat => ({
  seat, connected: true, rounds: [], total: { red: seat, blue: 2 }, hits: 0, leader: 'Red' as const,
  verdict: 'Red' as const, decided: true, decision_needed: false, pending: 0, awaiting_report: false, offline_refused: 0,
}));

const fight = (confirmed: boolean, actions: ActionView[]): FightView => ({
  ...emptyFight,
  actions,
  corners: { ...emptyFight.corners, Blue: { ...emptyFight.corners.Blue, warnings: 4, next_warning_dq: false } },
  judges,
  result: { ...emptyFight.result, final: true, confirmed },
});

const dqFight = (confirmed: boolean) => fight(confirmed, [
  action('w1', 'OfficialWarning'),
  action('undone-stop', 'Stoppage', { undone: true }),
  action('dq', 'OfficialWarning', { disqualifies: true }),
]);

describe('publicView', () => {
  it('hides the deciding action and undone stoppages until the result is confirmed', () => {
    const v = publicView(fight(false, [action('w', 'OfficialWarning'), action('undone-stop', 'Stoppage', { undone: true }), action('s', 'Stoppage')]));
    expect(v.actions.map(a => a.id)).toEqual(['w']);
  });

  it('does not count the disqualifying warning before confirmation', () => {
    const v = publicView(dqFight(false));
    expect(v.actions.map(a => a.id)).toEqual(['w1']);
    expect(v.corners.Blue).toMatchObject({ warnings: 3, next_warning_dq: true });
    expect(v.corners.Red).toEqual(emptyFight.corners.Red);
  });

  it("hides judges' verdicts but keeps their scores before confirmation", () => {
    const v = publicView(dqFight(false));
    expect(v.judges.map(j => [j.verdict, j.decided])).toEqual([['', false], ['', false], ['', false]]);
    expect(v.judges.map(j => j.total)).toEqual(judges.map(j => j.total));
  });

  it('shows everything once the result is confirmed', () => {
    const f = dqFight(true);
    expect(publicView(f)).toBe(f);
  });
});
