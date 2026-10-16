import { describe, expect, it } from 'vitest';
import { ActionQueue, type KVStorage } from './queue';

function memoryStorage(): KVStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: k => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

const tap = (id: string, t: number) => ({ id, type: 'REGISTER_HIT', payload: { corner: 'Red' }, client_time: t });

describe('ActionQueue', () => {
  it('keeps unanswered actions in order', () => {
    const q = new ActionQueue('q', memoryStorage());
    q.add(tap('a', 1));
    q.add(tap('b', 2));
    q.add(tap('c', 3));
    expect(q.pending().map(a => a.id)).toEqual(['a', 'b', 'c']);
  });

  it('drops an action once it is answered', () => {
    const q = new ActionQueue('q', memoryStorage());
    q.add(tap('a', 1));
    q.add(tap('b', 2));
    q.settle('a');
    q.settle('unknown');
    expect(q.pending().map(a => a.id)).toEqual(['b']);
  });

  it('survives a page reload', () => {
    const storage = memoryStorage();
    const before = new ActionQueue('queue:judge:1', storage);
    before.add(tap('a', 1));
    before.add(tap('b', 2));
    before.settle('a');

    const after = new ActionQueue('queue:judge:1', storage);
    expect(after.pending()).toEqual([tap('b', 2)]);
  });

  it('keeps separate queues per seat', () => {
    const storage = memoryStorage();
    new ActionQueue('queue:judge:1', storage).add(tap('a', 1));
    expect(new ActionQueue('queue:judge:2', storage).size).toBe(0);
  });

  it('works without storage and ignores corrupt data', () => {
    const q = new ActionQueue('q', null);
    q.add(tap('a', 1));
    expect(q.size).toBe(1);

    const storage = memoryStorage();
    storage.setItem('q', '{not json');
    expect(new ActionQueue('q', storage).size).toBe(0);
  });
});
