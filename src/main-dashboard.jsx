import React from 'react';
import { createRoot } from 'react-dom/client';
import DashboardApp from './dashboard/DashboardApp.jsx';
import './styles/global.css';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <DashboardApp />
  </React.StrictMode>
);
