import React from 'react';
import ArcReactor from './components/ArcReactor.jsx';
import DevicesPanel from './components/DevicesPanel.jsx';
import NotesPanel from './components/NotesPanel.jsx';
import SettingsPanel from './components/SettingsPanel.jsx';
import StatusBar from './components/StatusBar.jsx';
import Transcript from './components/Transcript.jsx';
import { useJarvis } from './hooks/useJarvis.js';

export default function App() {
  const jarvis = useJarvis();
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [devicesOpen, setDevicesOpen] = React.useState(false);

  return (
    <main
      className="hud-grid scanline notranslate relative min-h-screen overflow-hidden bg-void text-slate-100"
      translate="no"
      spellCheck={false}
    >
      <StatusBar
        status={jarvis.status}
        liveReady={jarvis.liveReady}
        address={jarvis.address}
        onAddressChange={jarvis.setAddress}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenDevices={() => setDevicesOpen(true)}
      />
      <div className="grid min-h-[calc(100vh-88px)] grid-cols-1 lg:grid-cols-[320px_minmax(360px,1fr)_380px]">
        <NotesPanel
          notes={jarvis.notes}
          onSearch={jarvis.refreshNotes}
          onDelete={jarvis.deleteNote}
        />
        <div className="flex flex-col">
          <ArcReactor status={jarvis.status} audioLevel={jarvis.voice.audioLevel} />
          <section className="mx-auto grid w-full max-w-4xl gap-3 px-4 pb-6 sm:grid-cols-3">
            <button
              onClick={jarvis.voice.monitoring ? jarvis.voice.stopListening : jarvis.voice.startListening}
              className="rounded border border-reactor/40 bg-reactor/10 px-4 py-3 text-sm font-semibold text-reactor hover:bg-reactor/20"
            >
              {jarvis.voice.monitoring ? 'Pause monitoring' : 'Resume monitoring'}
            </button>
            <button
              onClick={() => jarvis.sendMessage('Show my notes')}
              className="rounded border border-slate-600 bg-slate-900/50 px-4 py-3 text-sm font-semibold text-slate-200 hover:border-reactor"
            >
              Show my notes
            </button>
            <button
              onClick={() => jarvis.sendMessage('What is the current time and date?')}
              className="rounded border border-warning/40 bg-warning/10 px-4 py-3 text-sm font-semibold text-warning hover:bg-warning/20"
            >
              Time check
            </button>
          </section>
          {!jarvis.voice.supported && (
            <p className="mx-auto max-w-2xl px-4 pb-6 text-center text-sm text-warning">
              Speech recognition is unavailable in this browser. Text mode is standing by with a polished expression.
            </p>
          )}
        </div>
        <Transcript
          messages={jarvis.messages}
          input={jarvis.input}
          setInput={jarvis.setInput}
          onSend={jarvis.sendMessage}
          searchResults={jarvis.searchResults}
        />
      </div>
      <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <DevicesPanel open={devicesOpen} onClose={() => setDevicesOpen(false)} />
    </main>
  );
}
