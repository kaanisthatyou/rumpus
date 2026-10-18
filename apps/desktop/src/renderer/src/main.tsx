import '@lonca/ui/styles.css';
import './app.css';
import './channel/channel.css';
import './board/board.css';
import './records/records.css';
import './goals/goals.css';
import './memory/memory.css';
import './projects/projects.css';
import './i18n';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { Unpaired } from './shell/Unpaired';
import { startWeb } from './web';

const root = document.getElementById('root');
if (root) {
  void startWeb().then((mode) =>
    createRoot(root).render(<StrictMode>{mode === 'unpaired' ? <Unpaired /> : <App />}</StrictMode>),
  );
}
