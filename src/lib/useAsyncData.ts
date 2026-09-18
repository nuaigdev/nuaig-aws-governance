"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Loads async data on mount and whenever `deps` change.
 *
 * Exists because the naive version of this — an effect that calls
 * `setLoading(true)` and then awaits — has two real problems that every screen
 * would otherwise repeat:
 *
 *  1. **Stale responses.** Change folder twice quickly and the first request can
 *     resolve last, painting the previous folder's contents over the current
 *     one. Each run here is tagged, and a response from a superseded run is
 *     discarded.
 *  2. **Updates after unmount.** Navigating away mid-request would otherwise
 *     set state on a component that is gone.
 *
 * It also keeps the first `setState` behind an `await`, which is what
 * `react-hooks/set-state-in-effect` is pointing at: a synchronous `setState` in
 * an effect body triggers a second render pass before the browser paints.
 */
export interface AsyncData<T> {
  readonly data: T;
  readonly loading: boolean;
  readonly error: unknown;
  /** Re-runs the fetch. Resolves once the state has settled. */
  readonly reload: () => Promise<void>;
  /** Replaces the data locally, without a fetch. */
  readonly setData: (updater: (current: T) => T) => void;
}

export function useAsyncData<T>(
  fetcher: () => Promise<T>,
  initial: T,
  deps: readonly unknown[] = [],
): AsyncData<T> {
  const [data, setData] = useState<T>(initial);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

  // The fetcher is usually an inline closure, so it is a new function every
  // render. Holding it in a ref keeps it out of the effect's dependency list
  // while still calling the latest one.
  //
  // Assigned in an effect rather than during render: writing to a ref while
  // rendering is not safe under concurrent rendering, where a render can be
  // thrown away before it commits.
  const fetcherRef = useRef(fetcher);
  useEffect(() => {
    fetcherRef.current = fetcher;
  });

  /** Incremented per run; a response whose tag is stale is dropped. */
  const runId = useRef(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = useCallback(async () => {
    const id = ++runId.current;

    // Yielding before the first setState keeps this out of the synchronous
    // effect body — see the note above.
    await Promise.resolve();
    if (!mounted.current || runId.current !== id) return;

    setLoading(true);
    setError(null);

    try {
      const result = await fetcherRef.current();
      if (!mounted.current || runId.current !== id) return;
      setData(result);
    } catch (caught) {
      if (!mounted.current || runId.current !== id) return;
      setError(caught);
    } finally {
      if (mounted.current && runId.current === id) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void run();
    // `run` is stable; `deps` is the caller's intent about when to refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run, ...deps]);

  const patch = useCallback((updater: (current: T) => T) => {
    setData((current) => updater(current));
  }, []);

  return { data, loading, error, reload: run, setData: patch };
}
