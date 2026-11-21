import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/fraunces/400.css';
import '@fontsource/fraunces/500.css';
import '@fontsource/fraunces/600.css';
import '@fontsource/fraunces/700.css';
import '@fontsource/fraunces/400-italic.css';
import '@fontsource/fraunces/500-italic.css';
import '@fontsource/fraunces/600-italic.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import AppGate from './AppGate';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppGate />
  </StrictMode>,
);
