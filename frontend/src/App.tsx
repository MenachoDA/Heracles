import React, { useState } from 'react';
import Sidebar, { type EnrichmentViewType } from './components/Sidebar';
import EnrichmentView from './components/EnrichmentView';

const VIEWS: EnrichmentViewType[] = ['po', 'csf'];

const App: React.FC = () => {
  const [activeView, setActiveView] = useState<EnrichmentViewType>('po');

  return (
    <div className="min-h-screen flex">
      <Sidebar activeView={activeView} onSelectView={setActiveView} />

      <main className="flex-1 p-8 flex flex-col items-center">
        {VIEWS.map((view) => (
          <EnrichmentView
            key={view}
            type={view}
            isActive={activeView === view}
          />
        ))}
      </main>
    </div>
  );
};

export default App;
