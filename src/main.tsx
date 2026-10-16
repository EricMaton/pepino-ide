import '@fontsource-variable/archivo/wdth.css';
import '@fontsource-variable/jetbrains-mono';
import './ui/tokens.css';
import './ui/global.css';
import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { createServices, ServicesContext } from './app/services';
import { installFullText } from './ui/fullText';
import { SnackbarProvider } from './ui/snackbar';

// Truncated text anywhere shows whole when held
installFullText();

// Component catalog for iterating on the design system: `npm run dev`, then open /#catalog.
const Catalog = import.meta.env.DEV && location.hash === '#catalog' ? lazy(() => import('./dev/Catalog')) : null;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ServicesContext value={createServices()}>
      <SnackbarProvider>
        {Catalog ? (
          <Suspense>
            <Catalog />
          </Suspense>
        ) : (
          <App />
        )}
      </SnackbarProvider>
    </ServicesContext>
  </StrictMode>,
);
