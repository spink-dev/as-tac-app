import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import 'maplibre-gl/dist/maplibre-gl.css';
import './ui/styles/tokens.css';
import './ui/styles/base.css';
import './ui/styles/components.css';
import './ui/styles/app.css';
import { App } from './App';

const root = document.getElementById('root');
if (!root) {
    throw new Error('root element missing');
}
createRoot(root).render(
    <StrictMode>
        <App />
    </StrictMode>,
);
