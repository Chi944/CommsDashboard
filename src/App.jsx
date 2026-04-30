import React, { useState } from 'react';
import Ticker from './components/Ticker.jsx';
import Nav from './components/Nav.jsx';
import Overview from './components/Overview.jsx';
import Prices from './components/Prices.jsx';
import Intel from './components/Intel.jsx';
import NotificationsDrawer from './components/NotificationsDrawer.jsx';
import { LiveDataProvider } from './state/LiveData.jsx';

export default function App() {
  const [tab, setTab] = useState('Overview');
  const [alertsOpen, setAlertsOpen] = useState(false);

  return (
    <LiveDataProvider>
      <div className="min-h-screen bg-gray-950 text-gray-100">
        <div className="sticky top-0 z-30">
          <Ticker />
          <Nav active={tab} setActive={setTab} onOpenAlerts={() => setAlertsOpen(true)} />
        </div>

        <main className="px-6 py-6 max-w-[1600px] mx-auto">
          {tab === 'Overview' && <Overview />}
          {tab === 'Prices' && <Prices />}
          {tab === 'Intel' && <Intel />}
        </main>

        <NotificationsDrawer open={alertsOpen} onClose={() => setAlertsOpen(false)} />

        <footer className="px-6 py-4 border-t border-gray-800 text-[11px] text-gray-500 flex items-center justify-between">
          <span>Live data: Yahoo Finance (prices), Google News RSS (news). All numbers update from real APIs.</span>
          <span className="font-mono">v0.4.0</span>
        </footer>
      </div>
    </LiveDataProvider>
  );
}
