import React from 'react';
import { Search, Trash2 } from 'lucide-react';

export default function NotesPanel({ notes, onSearch, onDelete }) {
  return (
    <aside className="flex h-full min-h-[320px] flex-col border-r border-reactor/20 bg-panel/70 p-4">
      <div>
        <p className="text-xs uppercase tracking-[0.22em] text-reactor/75">Notes</p>
        <h2 className="mt-1 text-xl font-semibold">Field Archive</h2>
      </div>
      <label className="mt-4 flex items-center gap-2 rounded border border-slate-700 bg-void/60 px-3 py-2">
        <Search size={16} className="text-reactor" />
        <input
          onChange={(event) => onSearch(event.target.value)}
          placeholder="Search notes"
          className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-slate-500"
        />
      </label>
      <div className="mt-4 flex-1 space-y-3 overflow-y-auto pr-1">
        {notes.length === 0 && (
          <p className="rounded border border-slate-800 p-3 text-sm text-slate-400">No notes yet. A clean slate, Sir. Suspicious but efficient.</p>
        )}
        {notes.map((note, index) => (
          <article key={note.id} className="rounded border border-reactor/15 bg-void/60 p-3">
            <div className="flex items-start justify-between gap-2">
              <h3 className="text-sm font-semibold text-reactor">{index + 1}. {note.title}</h3>
              <button
                onClick={() => onDelete(note.id)}
                className="rounded border border-warning/35 p-1 text-warning hover:bg-warning/10"
                aria-label={`Delete ${note.title}`}
              >
                <Trash2 size={14} />
              </button>
            </div>
            <p className="mt-2 whitespace-pre-wrap text-sm text-slate-300">{note.content}</p>
            <p className="mt-3 text-xs text-slate-500">{new Date(note.updated_at).toLocaleString()}</p>
          </article>
        ))}
      </div>
    </aside>
  );
}
