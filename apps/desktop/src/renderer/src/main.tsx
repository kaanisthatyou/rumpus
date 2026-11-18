import '@lonca/ui/styles.css';
import './app.css';
import './channel/channel.css';
import './board/board.css';
import './records/records.css';
import './goals/goals.css';
import './races/races.css';
import './memory/memory.css';
import './projects/projects.css';
import './agents/specialists.css';
import './overview/overview.css';
import './routines/routines.css';
import './channel/reports.css';
import './shell/layout.css';
import './people/people.css';
import './i18n';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { Island } from './shell/Island';
import { Unpaired } from './shell/Unpaired';
import { startWeb } from './web';

const root = document.getElementById('root');
if (root && window.location.hash === '#quick') {
  document.documentElement.dataset.quick = '1';
  createRoot(root).render(
    <StrictMode>
      <Island />
    </StrictMode>,
  );
} else if (root) {
  void startWeb().then((mode) =>
    createRoot(root).render(<StrictMode>{mode === 'unpaired' ? <Unpaired /> : <App />}</StrictMode>),
  );
}
