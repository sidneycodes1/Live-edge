import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api.js';
import { onDataRefresh } from '../lib/data-bus.js';

// One source of truth for the wallet/portfolio data. The header and the Portfolio
// page both read from here, so a balance change (trade/claim/fee/faucet) reflected
// by a refresh() shows up everywhere — no second fetch path that can drift (T2).
export const BalanceContext = createContext(null);

export function useBalance() {
  return useContext(BalanceContext);
}

export function useBalanceProvider(user) {
  const [data, setData] = useState(null); // { balance, positions, createdMarkets }
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!user) { setData(null); return; }
    setLoading(true);
    try {
      const p = await api.getPortfolio();
      setData(p);
    } catch { /* keep last known value on transient failure */ }
    finally { setLoading(false); }
  }, [user]);

  useEffect(() => {
    refresh();
    // Re-fetch whenever app data changes (fired on every toast).
    const off = onDataRefresh(refresh);
    return off;
  }, [refresh]);

  return {
    data,
    balance: data ? Number(data.balance) : null,
    positions: data ? data.positions : [],
    createdMarkets: data ? data.createdMarkets : [],
    loading,
    refresh,
    // Allow optimistic local writes (e.g. right after a claim) without a refetch.
    setData,
  };
}
