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

  it('shares one queue between two tabs of the same seat', () => {
    const storage = memoryStorage();
    const tab1 = new ActionQueue('queue:judge:1', storage);
    const tab2 = new ActionQueue('queue:judge:1', storage);
    tab1.add(tap('a', 1));
    tab2.add(tap('b', 2));
    tab1.add(tap('c', 3));
    tab2.settle('a');
    expect(tab1.pending().map(a => a.id)).toEqual(['b', 'c']);
  });

  it('keeps working in memory when storage is full', () => {
    const storage = memoryStorage();
    const q = new ActionQueue('q', storage);
    q.add(tap('a', 1));
    storage.setItem = () => { throw new Error('QuotaExceededError'); };
    q.add(tap('b', 2));
    q.add(tap('c', 3));
    expect(q.pending().map(a => a.id)).toEqual(['a', 'b', 'c']);
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
