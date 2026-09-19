import { useCallback, useEffect, useRef, useState } from "react";
import { apiGet } from "./api";

/** GET périodique d'un endpoint du dashboard (données réelles, jamais simulées). */
export function usePolling<T>(path: string, everyMs = 4000) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  const load = useCallback(async () => {
    try { const d = await apiGet<T>(path); if (alive.current) { setData(d); setError(null); } }
    catch (e) { if (alive.current) setError((e as Error).message); }
  }, [path]);
  useEffect(() => {
    alive.current = true;
    void load();
    const t = setInterval(() => void load(), everyMs);
    return () => { alive.current = false; clearInterval(t); };
  }, [load, everyMs]);
  return { data, error, reload: load };
}
