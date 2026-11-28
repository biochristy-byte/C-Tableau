// C-Tableau stand-in for '@analytics/data-app-sdk/react'. useQuery(id) returns the state a Next data app waits on.
import { useState, useEffect, useCallback } from 'react';
import { runQuery } from './sdk.js';

// SDK SHAPES (hook state): { loading, loadedOnce, error, result: { rows, rowCount } | null, refetch }.
export function useQuery(id) {
  var s = useState({ loading: true, loadedOnce: false, error: null, result: null }), st = s[0], set = s[1];
  var run = useCallback(function () {
    var alive = true;
    set(function (p) { return { loading: true, loadedOnce: p.loadedOnce, error: null, result: p.result }; });
    runQuery(id).then(function (r) { if (alive) set({ loading: false, loadedOnce: true, error: null, result: r }); },
      function (e) { if (alive) set({ loading: false, loadedOnce: true, error: e, result: null }); });
    return function () { alive = false; };
  }, [id]);
  useEffect(run, [run]);
  return { loading: st.loading, loadedOnce: st.loadedOnce, error: st.error, result: st.result, data: st.result, refetch: run };
}
export default useQuery;
