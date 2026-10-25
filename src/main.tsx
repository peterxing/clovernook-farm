import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import './styles.css';

// StrictMode is left out: its double-mounting fights the imperative Leaflet and ECharts widgets.
createRoot(document.getElementById('root')!).render(<App />);
