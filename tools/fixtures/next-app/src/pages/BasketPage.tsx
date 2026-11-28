import React, { useEffect, useRef, useState } from 'react';
import { useQuery } from '@analytics/data-app-sdk/react';
import '../legacy/draw.js';
import '../styles/app.css';

declare const LL: any;
const PARTS = ['linesCentral', 'linesEast'];

export default function BasketPage() {
  const root = useRef<HTMLDivElement>(null);
  const [err, setErr] = useState<string | null>(null);
  const parts = [useQuery(PARTS[0]), useQuery(PARTS[1])];
  const byRegion = useQuery('byRegion');
  const sample = useQuery('sampleCentral');
  const all = [...parts, byRegion, sample];
  const ready = all.every((p) => p.loadedOnce && p.result);
  useEffect(() => {
    const bad = all.find((p) => p.error);
    if (bad) { setErr(String(bad.error)); return; }
    if (!ready || !root.current) return;
    const rows = parts.flatMap((p) => p.result!.rows);
    LL.start(root.current, rows, byRegion.result!.rows, sample.result!.rows);
  }, [ready]);
  return <div className="page"><h1>Fixture Basket</h1>{err ? <p id="err">{err}</p> : null}<div ref={root} id="out" /></div>;
}
