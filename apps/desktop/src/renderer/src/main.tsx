import '@lonca/ui/styles.css';
import './app.css';
import './channel/channel.css';
import './board/board.css';
import './records/records.css';
import './goals/goals.css';
import './i18n';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
