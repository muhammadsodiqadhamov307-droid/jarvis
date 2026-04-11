import React from 'react';
import { Send } from 'lucide-react';

export default function Transcript({ messages, input, setInput, onSend, searchResults }) {
  return (
    <aside className="flex h-full min-h-[360px] flex-col border-l border-reactor/20 bg-panel/70 p-4">
      <div>
        <p className="text-xs uppercase tracking-[0.22em] text-reactor/75">Transcript</p>
        <h2 className="mt-1 text-xl font-semibold">Conversation</h2>
      </div>
      <div className="mt-4 flex-1 space-y-3 overflow-y-auto pr-1">
        {[...messages].reverse().map((message) => (
          <div
            key={message.id}
            className={`rounded border p-3 text-sm ${
              message.role === 'user'
                ? 'border-warning/25 bg-warning/10'
                : 'border-reactor/25 bg-reactor/10'
            }`}
          >
            <p className="text-xs uppercase tracking-[0.18em] text-slate-400">{message.role === 'user' ? 'You' : 'JARVIS'}</p>
            <p className="mt-2 whitespace-pre-wrap text-slate-100">{message.content}</p>
          </div>
        ))}
        {searchResults?.results?.length > 0 && (
          <div className="rounded border border-reactor/20 bg-void/70 p-3 text-sm">
            <p className="text-xs uppercase tracking-[0.18em] text-reactor">Sources</p>
            {searchResults.results.map((result) => (
              <a key={result.url} href={result.url} target="_blank" rel="noreferrer" className="mt-2 block text-slate-300 hover:text-reactor">
                {result.title}
              </a>
            ))}
          </div>
        )}
      </div>
      <form
        className="mt-4 flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          onSend(input);
        }}
      >
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="Type if audio decides to be theatrical"
          className="min-w-0 flex-1 rounded border border-slate-700 bg-void/75 px-3 py-3 text-sm outline-none placeholder:text-slate-500 focus:border-reactor"
        />
        <button className="rounded bg-reactor px-4 py-3 text-sm font-semibold text-void hover:bg-cyan-300" type="submit">
          <Send size={18} />
        </button>
      </form>
    </aside>
  );
}
