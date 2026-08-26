import React, { Suspense, lazy, useEffect, useState } from 'react';
import { Analytics } from '@vercel/analytics/react';
import Ticker from './components/Ticker.jsx';
import Nav from './components/Nav.jsx';
import BottomNav from './components/BottomNav.jsx';
import NotificationsDrawer from './components/NotificationsDrawer.jsx';
import CommandPalette from './components/CommandPalette.jsx';
import { buildDashboardSearch, parseDashboardSearch } from './lib/dashboardRoute.js';
import { LiveDataProvider } from './state/LiveData.jsx';
import { SmartMoneyProvider } from './state/SmartMoney.jsx';

const Overview   = lazy(() => import('./components/Overview.jsx'));
const Prices     = lazy(() => import('./components/Prices.jsx'));
const Currency   = lazy(() => import('./components/Currency.jsx'));
const Portfolio  = lazy(() => import('./components/Portfolio.jsx'));
const Intel      = lazy(() => import('./components/Intel.jsx'));

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

function readInitialRoute() {
  return typeof window === 'undefined'
    ? parseDashboardSearch('')
    : parseDashboardSearch(window.location.search);
}

export function Dashboard() {
  const initial = readInitialRoute();
  const [tab, setTab] = useState(initial.tab);
  const [view, setView] = useState(initial.view);
  const [recordId, setRecordId] = useState(initial.recordId);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [ticker, setTicker] = useState(initial.ticker);

  const switchTab = (nextTab) => {
    setTab(nextTab);
    setRecordId(null);
    if (nextTab === 'Intel') setView('news');
    else if (nextTab === 'Portfolio') setView('holdings');
    else setView(null);
  };

  const openInPrices = (nextTicker) => {
    setTicker(nextTicker);
    setTab('Prices');
    setView(null);
    setRecordId(null);
  };

  const openSmartMoney = () => {
    setTab('Intel');
    setView('smart-money');
    setRecordId(null);
  };

  // Keyboard shortcuts: ⌘K / Ctrl+K opens command palette anywhere.
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setPaletteOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Reflect the complete research route in the URL so evidence links are durable.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const search = buildDashboardSearch(window.location.search, {
      tab, view, recordId, ticker,
    });
    const next = `${window.location.pathname}${search}`;
    window.history.replaceState(null, '', next);
  }, [recordId, tab, ticker, view]);

  return (
      <div className="min-h-screen text-gray-100">
        <div className="sticky top-0 z-30">
          <Ticker />
          <Nav
            active={tab}
            setActive={switchTab}
            onOpenAlerts={() => setAlertsOpen(true)}
            onOpenPalette={() => setPaletteOpen(true)}
          />
        </div>

        <main className="px-4 sm:px-6 py-5 sm:py-7 max-w-[1600px] mx-auto pb-24 md:pb-10 animate-fade-in">
          <Suspense fallback={<TabSkeleton />}>
            {tab === 'Overview'   && (
              <Overview onSelectAsset={openInPrices} onOpenSmartMoney={openSmartMoney} />
            )}
            {tab === 'Prices'     && <Prices initialTicker={ticker} onTickerChange={setTicker} />}
            {tab === 'Currency'   && <Currency />}
            {tab === 'Portfolio'  && (
              <Portfolio
                view={view || 'holdings'}
                onViewChange={(nextView) => setView(nextView)}
                onSelectAsset={openInPrices}
              />
            )}
            {tab === 'Intel'      && (
              <Intel
                view={view || 'news'}
                recordId={recordId}
                onViewChange={(nextView) => {
                  setView(nextView);
                  if (nextView !== 'smart-money') setRecordId(null);
                }}
                onRecordChange={setRecordId}
                onOpenPrices={openInPrices}
              />
            )}
          </Suspense>
        </main>

        <NotificationsDrawer open={alertsOpen} onClose={() => setAlertsOpen(false)} />
        <BottomNav active={tab} setActive={switchTab} />
        <CommandPalette
          open={paletteOpen}
          onClose={() => setPaletteOpen(false)}
          onSelectAsset={(t) => openInPrices(t)}
          onSwitchTab={switchTab}
        />
        <Analytics />

        <footer className="hidden md:flex px-6 py-4 border-t border-gray-800 text-[11px] text-gray-500 items-center justify-between">
          <span>Live data: Yahoo Finance (prices), Google News RSS (news). Press <kbd className="font-mono px-1 rounded border border-gray-700 bg-gray-900">⌘K</kbd> to jump anywhere.</span>
          <span className="font-mono">v0.14.0</span>
        </footer>
      </div>
  );
}

export default function App() {
  return (
    <LiveDataProvider>
      <SmartMoneyProvider>
        <Dashboard />
      </SmartMoneyProvider>
    </LiveDataProvider>
  );
}
