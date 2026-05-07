import React, { useState } from 'react';
import { Analytics } from '@vercel/analytics/react';
import Ticker from './components/Ticker.jsx';
import Nav from './components/Nav.jsx';
import BottomNav from './components/BottomNav.jsx';
import Overview from './components/Overview.jsx';
import Prices from './components/Prices.jsx';
import Currency from './components/Currency.jsx';
import Intel from './components/Intel.jsx';
import NotificationsDrawer from './components/NotificationsDrawer.jsx';
import { LiveDataProvider } from './state/LiveData.jsx';

export default function App() {
  const [tab, setTab] = useState('Overview');
  const [alertsOpen, setAlertsOpen] = useState(false);
  // Cross-tab selection: clicking an asset on Overview jumps to Prices
  // pre-selected to that ticker.
  const [pendingTicker, setPendingTicker] = useState(null);

  const openInPrices = (ticker) => {
    setPendingTicker(ticker);
    setTab('Prices');
  };

  return (
    <LiveDataProvider>
      <div className="min-h-screen text-gray-100">
        <div className="sticky top-0 z-30">
          <Ticker />
          <Nav active={tab} setActive={setTab} onOpenAlerts={() => setAlertsOpen(true)} />
        </div>

        <main className="px-4 sm:px-6 py-5 sm:py-7 max-w-[1600px] mx-auto pb-24 md:pb-10 animate-fade-in">
          {tab === 'Overview' && <Overview onSelectAsset={openInPrices} />}
          {tab === 'Prices' && <Prices initialTicker={pendingTicker} onTickerConsumed={() => setPendingTicker(null)} />}
          {tab === 'Currency' && <Currency />}
          {tab === 'Intel' && <Intel />}
        </main>

        <NotificationsDrawer open={alertsOpen} onClose={() => setAlertsOpen(false)} />
        <BottomNav active={tab} setActive={setTab} />
        <Analytics />

        <footer className="hidden md:flex px-6 py-4 border-t border-gray-800 text-[11px] text-gray-500 items-center justify-between">
          <span>Live data: Yahoo Finance (prices), Google News RSS (news).</span>
          <span className="font-mono">v0.10.0</span>
        </footer>
      </div>
    </LiveDataProvider>
  );
}
