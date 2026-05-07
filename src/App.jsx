import React, { Suspense, lazy, useState } from 'react';
import { Analytics } from '@vercel/analytics/react';
import Ticker from './components/Ticker.jsx';
import Nav from './components/Nav.jsx';
import BottomNav from './components/BottomNav.jsx';
import NotificationsDrawer from './components/NotificationsDrawer.jsx';
import { LiveDataProvider } from './state/LiveData.jsx';

// Heavy tabs (Recharts pulled in by Prices/Currency) are split into
// separate chunks and lazy-loaded so the initial page paint stays fast.
const Overview = lazy(() => import('./components/Overview.jsx'));
const Prices   = lazy(() => import('./components/Prices.jsx'));
const Currency = lazy(() => import('./components/Currency.jsx'));
const Intel    = lazy(() => import('./components/Intel.jsx'));

const TabSkeleton = () => (
  <div className="space-y-4 animate-pulse">
    <div className="h-7 w-48 rounded-md bg-gray-800/60" />
    <div className="h-4 w-72 rounded bg-gray-800/40" />
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mt-4">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="h-28 rounded-xl bg-gray-900/60 border border-gray-800" />
      ))}
    </div>
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-2">
      <div className="h-72 rounded-xl bg-gray-900/60 border border-gray-800" />
      <div className="h-72 rounded-xl bg-gray-900/60 border border-gray-800" />
      <div className="h-72 rounded-xl bg-gray-900/60 border border-gray-800" />
    </div>
  </div>
);

export default function App() {
  const [tab, setTab] = useState('Overview');
  const [alertsOpen, setAlertsOpen] = useState(false);
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
          <Suspense fallback={<TabSkeleton />}>
            {tab === 'Overview' && <Overview onSelectAsset={openInPrices} />}
            {tab === 'Prices' && (
              <Prices
                initialTicker={pendingTicker}
                onTickerConsumed={() => setPendingTicker(null)}
              />
            )}
            {tab === 'Currency' && <Currency />}
            {tab === 'Intel' && <Intel />}
          </Suspense>
        </main>

        <NotificationsDrawer open={alertsOpen} onClose={() => setAlertsOpen(false)} />
        <BottomNav active={tab} setActive={setTab} />
        <Analytics />

        <footer className="hidden md:flex px-6 py-4 border-t border-gray-800 text-[11px] text-gray-500 items-center justify-between">
          <span>Live data: Yahoo Finance (prices), Google News RSS (news).</span>
          <span className="font-mono">v0.11.0</span>
        </footer>
      </div>
    </LiveDataProvider>
  );
}
