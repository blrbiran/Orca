/** Only the active owner reads. A changed scope, epoch or projection retires pending answers. */
import { useEffect, useRef, useState } from "react";
import { onLoginRequired } from "./api.js";
import { controlFailureFrom } from "./controlApi.js";
export function useResultsRead<T>(active: boolean, identity: string, read: (signal: AbortSignal) => Promise<T>, admit: (answer: T, prior: T | null) => boolean): { value: T | null; error: string | null } {
 const [state, setState] = useState<{ identity: string; value: T | null; error: string | null } | null>(null);
 const owner = useRef({active, identity}); owner.current = {active, identity};
 const readRef = useRef(read); readRef.current = read;
 const admitRef = useRef(admit); admitRef.current = admit;
 useEffect(() => {
  if (!active) { setState(null); return; }
  let live = true, revoked = false, prior: T | null = null;
  let controller: AbortController | null = null;
  const clearAuth = onLoginRequired(() => { revoked = true; controller?.abort(); setState(null); });
  const load = async (): Promise<void> => {
   if (!live || revoked || controller !== null) return;
   const request = new AbortController(); controller = request;
   try {
    const answer = await readRef.current(request.signal);
    if (live && !revoked && owner.current.active && owner.current.identity === identity && admitRef.current(answer, prior)) { prior = answer; setState({ identity, value: answer, error: null }); }
    else if (live && !revoked && owner.current.active && owner.current.identity === identity) setState({ identity, value: prior, error: "result-response-stale" });
   } catch (error) { if (live && !revoked && owner.current.active && owner.current.identity === identity) setState({ identity, value: null, error: controlFailureFrom(error).code }); }
   finally { if (controller === request) controller = null; }
  };
  void load(); const timer = setInterval(() => void load(), 2000);
  return () => { live = false; controller?.abort(); clearInterval(timer); clearAuth(); };
 }, [active, identity]);
 return active && state?.identity === identity ? state : { value: null, error: null };
}
