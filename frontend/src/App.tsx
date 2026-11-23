import React, { useState, useCallback } from 'react';
import Sidebar, { type EnrichmentViewType, type AppViewType } from './components/Sidebar';
import EnrichmentView from './components/EnrichmentView';
import DashboardView from './components/DashboardView';

const VIEWS: EnrichmentViewType[] = ['po', 'csf'];

const App: React.FC = () => {
  const [activeView, setActiveView] = useState<AppViewType>('dashboard');
  const [dashboardRefreshKey, setDashboardRefreshKey] = useState<number>(0);

  const handleProcessSuccess = useCallback(() => {
    setDashboardRefreshKey((prev) => prev + 1);
  }, []);

  return (
    <div className="min-h-screen flex">
      <Sidebar activeView={activeView} onSelectView={setActiveView} />

      <main className="flex-1 p-8 flex flex-col items-center overflow-x-hidden">
        <DashboardView
          isActive={activeView === 'dashboard'}
          refreshTrigger={dashboardRefreshKey}
        />

        {VIEWS.map((view) => (
          <EnrichmentView
            key={view}
            type={view}
            isActive={activeView === view}
            onProcessSuccess={handleProcessSuccess}
          />
        ))}
      </main>
    </div>
  );
};

export default App;
