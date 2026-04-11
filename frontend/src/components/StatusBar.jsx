import React from 'react';
import { Mic, Radio, ShieldCheck } from 'lucide-react';

export default function StatusBar({ status, liveReady, address, onAddressChange }) {
  return (
    <header className="flex flex-col gap-4 border-b border-reactor/20 bg-void/70 px-4 py-4 backdrop-blur md:flex-row md:items-center md:justify-between">
      <div>
        <h1 className="text-2xl font-semibold uppercase tracking-[0.18em] text-reactor">JARVIS</h1>
        <p className="mt-1 text-sm text-slate-300">Just A Rather Very Intelligent System</p>
      </div>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="inline-flex items-center gap-2 rounded border border-reactor/35 px-3 py-2 text-reactor">
          <ShieldCheck size={16} /> {status}
        </span>
        <span className={`inline-flex items-center gap-2 rounded border px-3 py-2 ${liveReady ? 'border-reactor/35 text-reactor' : 'border-warning/35 text-warning'}`}>
          <Radio size={16} /> {liveReady ? 'LIVE READY' : 'TEXT FALLBACK'}
        </span>
        <label className="inline-flex items-center gap-2 rounded border border-slate-600 px-3 py-2 text-slate-200">
          <Mic size={16} />
          Address me as
          <input
            value={address}
            onChange={(event) => onAddressChange(event.target.value)}
            className="w-20 bg-transparent text-reactor outline-none"
            aria-label="Preferred address"
          />
        </label>
      </div>
    </header>
  );
}
