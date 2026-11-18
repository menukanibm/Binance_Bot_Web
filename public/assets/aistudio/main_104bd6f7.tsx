import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { LoginScreen } from './components/LoginScreen.tsx';
import { ExchangeSelectionScreen, ExchangeType } from './components/ExchangeSelectionScreen.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import './index.css';

// Global runtime error & unhandled promise rejection logger for debugging
if (typeof window !== 'undefined') {
  window.addEventListener('error', (event) => {
    console.error('[Global Window Error]', event.message, event.error || event);
  });
  window.addEventListener('unhandledrejection', (event) => {
    console.error('[Global Unhandled Rejection]', event.reason);
  });
}

// Purge any legacy cached auth state on boot so sessions NEVER persist across app launches
try {
  localStorage.removeItem('menuka_trading_auth');
  sessionStorage.clear();
} catch {}

// In Electron Desktop (.exe), unregister any old ServiceWorkers and purge CacheStorage
// so a cached bundle can NEVER bypass the Firebase Login screen.
if (typeof window !== 'undefined' && (window as any).electronAPI) {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker
      .getRegistrations()
      .then((regs) => regs.forEach((r) => r.unregister()))
      .catch(() => null);
  }
  if ('caches' in window) {
    caches
      .keys()
      .then((keys) => keys.forEach((k) => caches.delete(k)))
      .catch(() => null);
  }
} else if ('serviceWorker' in navigator && typeof window !== 'undefined') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => null);
  });
}

function RootAuthGate() {
  const [currentHash, setCurrentHash] = useState(() => {
    try {
      return typeof window !== 'undefined' ? window.location.hash : '';
    } catch {
      return '';
    }
  });

  useEffect(() => {
    const handleHashChange = () => {
      try {
        setCurrentHash(window.location.hash || '');
      } catch {}
    };
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  // Dedicated App Mode Checks
  const isDirectUpgrade =
    currentHash === '#upgrade' ||
    (typeof window !== 'undefined' && window.location.search.includes('upgrade'));

  // Step 1: Strictly launch Firebase Login UI first for the Main Bot.
  const [unlockedUser, setUnlockedUser] = useState<string | null>(null);
  // Step 2: Exchange Selection & WebSocket Gatekeeper before entering TradingDashboard (<App />).
  const [verifiedExchange, setVerifiedExchange] = useState<ExchangeType | null>(null);

  useEffect(() => {
    try {
      localStorage.removeItem('menuka_trading_auth');
    } catch {}
  }, []);

  // Standalone Upgrade Station Mode
  if (isDirectUpgrade) {
    return (
      <ErrorBoundary fallbackTitle="Makka Depth Sniper Entries — Upgrade Tool">
        <App
          authenticatedUser="Operator"
          initialVerifiedExchange="BINANCE"
          onLogoutRoot={() => {
            try {
              window.location.hash = '';
            } catch {}
            setCurrentHash('');
            setUnlockedUser(null);
          }}
        />
      </ErrorBoundary>
    );
  }

  if (!unlockedUser) {
    return (
      <ErrorBoundary fallbackTitle="Makka Depth Sniper Entries — Login Screen Error Boundary">
        <LoginScreen
          onLoginSuccess={(username) => {
            setUnlockedUser(username || 'Menuka');
            setVerifiedExchange(null);
          }}
        />
      </ErrorBoundary>
    );
  }

  if (!verifiedExchange) {
    return (
      <ErrorBoundary fallbackTitle="Makka Depth Sniper Entries — Exchange Selection Error Boundary">
        <ExchangeSelectionScreen
          username={unlockedUser}
          onExchangeConnected={(exchange) => {
            try {
              localStorage.setItem('makka_active_exchange', exchange);
            } catch {}
            setVerifiedExchange(exchange);
          }}
          onLogout={() => {
            setVerifiedExchange(null);
            setUnlockedUser(null);
          }}
        />
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary fallbackTitle="Makka Depth Sniper Entries — Trading Dashboard Error Boundary">
      <App
        authenticatedUser={unlockedUser}
        initialVerifiedExchange={verifiedExchange}
        onLogoutRoot={() => {
          setVerifiedExchange(null);
          setUnlockedUser(null);
        }}
      />
    </ErrorBoundary>
  );
}

const rootElement = document.getElementById('root');
if (rootElement) {
  createRoot(rootElement).render(
    <ErrorBoundary fallbackTitle="Makka Depth Sniper Entries — Root Application Error Boundary">
      <RootAuthGate />
    </ErrorBoundary>
  );
}
