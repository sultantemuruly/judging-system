import { useSyncExternalStore } from 'react';
import { getJudgeAccess, subscribeToJudgeAccess } from '../api/socket';
import type { JudgeAccessPayload } from '../api/protocol';

/** Which judge seats need a password, kept up to date by the server. */
export function useJudgeAccess(): JudgeAccessPayload {
  return useSyncExternalStore(subscribeToJudgeAccess, getJudgeAccess);
}
