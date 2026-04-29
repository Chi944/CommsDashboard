import React, { useState } from 'react';
import Ticker from './components/Ticker.jsx';
import Nav from './components/Nav.jsx';
import Overview from './components/Overview.jsx';
import Prices from './components/Prices.jsx';
import Routes from './components/Routes.jsx';
import Calculator from './components/Calculator.jsx';
import Intel from './components/Intel.jsx';
import NotificationsDrawer from './components/NotificationsDrawer.jsx';

export default function App() {
  const [tab, setTab] = useState('Overview');
  const [alertsOpen, setAlertsOpen] = useState(false);

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <div className="sticky top-0 z-30">
        <Ticker />
        <Nav active={tab} setActive={setTab} onOpenAlerts={() => setAlertsOpen(true)} />
      </div>

      <main className="px-6 py-6 max-w-[1600px] mx-auto">
        {tab === 'Overview' && <Overview />}
        {tab === 'Prices' && <Prices />}
        {tab === 'Routes' && <Routes />}
        {tab === 'Calculator' && <Calculator />}
        {tab === 'Intel' && <Intel />}
      </main>

      <NotificationsDrawer open={alertsOpen} onClose={() => setAlertsOpen(false)} />

      <footer className="px-6 py-4 border-t border-gray-800 text-[11px] text-gray-500 flex items-center justify-between">
        <span>Mock data — for demonstration purposes only.</span>
        <span className="font-mono">v0.2.0 • last refreshed: just now</span>
      </footer>
    </div>
  );
}
