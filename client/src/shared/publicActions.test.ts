import { describe, expect, it } from 'vitest';
import { emptyFight, type ActionView, type FightView } from '../api/protocol';
import { publicActions } from './publicActions';

const action = (id: string, type: ActionView['type'], extra: Partial<ActionView> = {}): ActionView =>
  ({ id, type, corner: 'Red', round: 1, at: 0, undone: false, ...extra });
const fight = (confirmed: boolean): FightView => ({
  ...emptyFight,
  actions: [
    action('w', 'OfficialWarning'),
    action('undone-stop', 'Stoppage', { undone: true }),
    action('dq', 'OfficialWarning', { disqualifies: true }),
    action('s', 'Stoppage'),
  ],
  result: { ...emptyFight.result, final: true, confirmed },
});

describe('publicActions', () => {
  it('hides a stoppage and a disqualifying warning until the result is confirmed', () => {
    expect(publicActions(fight(false)).map(a => a.id)).toEqual(['w', 'undone-stop']);
  });

  it('shows everything once the result is confirmed', () => {
    expect(publicActions(fight(true)).map(a => a.id)).toEqual(['w', 'undone-stop', 'dq', 's']);
  });
});
