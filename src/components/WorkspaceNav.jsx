import React from 'react';

// Navigation only: hosted research never contacts the local trading service.
export default function WorkspaceNav() {
  return (
    <nav aria-label="Workspace" className="workspace-nav">
      <span className="workspace-nav-label">Workspace</span>
      <a href="https://comms-dashboard-navy.vercel.app/" aria-current="page">Comms Dashboard</a>
      <a href="https://stock-research-ecru.vercel.app/">Stock Research</a>
      <a href="https://stock-research-ecru.vercel.app/#research-lab">Research Lab</a>
      <a href="http://127.0.0.1:8642/" title="Open the trading system running on this computer">
        Trading System <span className="workspace-local">local</span>
      </a>
    </nav>
  );
}
