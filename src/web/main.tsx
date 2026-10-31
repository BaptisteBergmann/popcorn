import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '@web/app';
import '@web/index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
