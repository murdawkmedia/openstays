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
import { PublicShowcasePage } from './pages/PublicShowcasePage';
import { PublicShowcaseBoundaryPage } from './pages/PublicShowcaseBoundaryPage';
import { PUBLIC_SHOWCASE } from './lib/publicShowcase';

const WavelengthWalletPage = lazy(() => import('./pages/WavelengthWalletPage'));
const ConsensusRewardPage = lazy(() => import('./pages/ConsensusRewardPage'));

const walletPaymentElement = PUBLIC_SHOWCASE.allowLiveWavelength ? (
  <Suspense fallback={<p className="p-8">Loading signet wallet…</p>}>
    <WavelengthWalletPage />
  </Suspense>
) : <PublicShowcaseBoundaryPage />;
const rewardWalletElement = PUBLIC_SHOWCASE.allowLiveWavelength ? (
  <Suspense fallback={<p className="p-8">Loading reward wallet…</p>}>
    <ConsensusRewardPage />
  </Suspense>
) : <PublicShowcaseBoundaryPage />;
const staffTapeElement = PUBLIC_SHOWCASE.allowStaffRoutes ? <AdminTapePage /> : <PublicShowcaseBoundaryPage />;
const staffOperationsElement = PUBLIC_SHOWCASE.allowStaffRoutes ? <AdminOperationsPage /> : <PublicShowcaseBoundaryPage />;
const staffSettingsElement = PUBLIC_SHOWCASE.allowStaffRoutes ? <AdminSettingsPage /> : <PublicShowcaseBoundaryPage />;
const staffLoginElement = PUBLIC_SHOWCASE.allowStaffRoutes ? <AdminLoginPage /> : <PublicShowcaseBoundaryPage />;

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
            <Route path="/" element={PUBLIC_SHOWCASE.enabled ? <PublicShowcasePage /> : <HomePage />} />
            <Route path="/p/:propertySlug" element={<PropertyPage />} />
            <Route path="/p/:propertySlug/stay/:unitTypeSlug" element={<UnitTypePage />} />
            <Route path="/checkout/:bookingId" element={<CheckoutPage />} />
            <Route path="/confirmation/:code" element={<ConfirmationPage />} />
            <Route path="/manage/:code" element={<ManageBookingPage />} />
            <Route path="/wallet/:bookingId" element={walletPaymentElement} />
            <Route path="/wallet/reward/:code" element={rewardWalletElement} />
            <Route path="/about" element={<AboutPage />} />
            <Route path="/admin" element={staffTapeElement} />
            <Route path="/admin/operations" element={staffOperationsElement} />
            <Route path="/admin/settings" element={staffSettingsElement} />
            <Route path="/admin/login" element={staffLoginElement} />
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </ConvexAuthProvider>
  </StrictMode>,
);
