import { useSyncExternalStore } from 'react';
import { getConnectionInfo, subscribeToStatus, type ConnectionInfo } from '../api/socket';

/** Connection status of this device and how many of its actions await confirmation. */
export function useConnection(): ConnectionInfo {
  return useSyncExternalStore(subscribeToStatus, getConnectionInfo);
}
