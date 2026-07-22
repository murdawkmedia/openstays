import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { ConvexReactClient } from 'convex/react';
import { ConvexAuthProvider } from '@convex-dev/auth/react';

import './index.css';
import { AppLayout } from './components/AppLayout';
import { HomePage } from './pages/HomePage';
import { PropertyPage } from './pages/PropertyPage';
import { UnitTypePage } from './pages/UnitTypePage';
import { CheckoutPage } from './pages/CheckoutPage';
import { ConfirmationPage } from './pages/ConfirmationPage';
import { ManageBookingPage } from './pages/ManageBookingPage';
import { AdminTapePage } from './pages/AdminTapePage';
import { AdminSettingsPage } from './pages/AdminSettingsPage';
import { AdminLoginPage } from './pages/AdminLoginPage';
import { AdminOperationsPage } from './pages/AdminOperationsPage';
import { AboutPage } from './pages/AboutPage';
import { NotFoundPage } from './pages/NotFoundPage';

const WavelengthWalletPage = lazy(() => import('./pages/WavelengthWalletPage'));
const ConsensusRewardPage = lazy(() => import('./pages/ConsensusRewardPage'));

const convexUrl = import.meta.env.VITE_CONVEX_URL as string | undefined;
if (!convexUrl) {
  // eslint-disable-next-line no-console
  console.error(
    'VITE_CONVEX_URL is not set. Run `npx convex dev` (or set the env var) to connect the app to a Convex deployment.',
  );
}
const convex = new ConvexReactClient(convexUrl ?? '');

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Root element #root not found.');

createRoot(rootElement).render(
  <StrictMode>
    <ConvexAuthProvider client={convex}>
      <BrowserRouter basename={import.meta.env.BASE_URL}>
        <Routes>
          <Route element={<AppLayout />}>
            <Route path="/" element={<HomePage />} />
            <Route path="/p/:propertySlug" element={<PropertyPage />} />
            <Route path="/p/:propertySlug/stay/:unitTypeSlug" element={<UnitTypePage />} />
            <Route path="/checkout/:bookingId" element={<CheckoutPage />} />
            <Route path="/confirmation/:code" element={<ConfirmationPage />} />
            <Route path="/manage/:code" element={<ManageBookingPage />} />
            <Route path="/wallet/:bookingId" element={<Suspense fallback={<p className="p-8">Loading signet wallet…</p>}><WavelengthWalletPage /></Suspense>} />
            <Route path="/wallet/reward/:code" element={<Suspense fallback={<p className="p-8">Loading reward wallet…</p>}><ConsensusRewardPage /></Suspense>} />
            <Route path="/about" element={<AboutPage />} />
            <Route path="/admin" element={<AdminTapePage />} />
            <Route path="/admin/operations" element={<AdminOperationsPage />} />
            <Route path="/admin/settings" element={<AdminSettingsPage />} />
            <Route path="/admin/login" element={<AdminLoginPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </ConvexAuthProvider>
  </StrictMode>,
);
