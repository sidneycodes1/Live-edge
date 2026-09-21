import { useApi } from './useApi.js';
import { api } from '../lib/api.js';

export function useRoom(id) {
  return useApi(() => api.getRoom(id), [id]);
}
