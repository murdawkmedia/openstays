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
import { AboutPage } from './pages/AboutPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { PublicShowcasePage } from './pages/PublicShowcasePage';
import { PublicShowcaseBoundaryPage } from './pages/PublicShowcaseBoundaryPage';
import { PUBLIC_SHOWCASE } from './lib/publicShowcase';

const IS_PUBLIC_SHOWCASE_BUILD = import.meta.env.VITE_PUBLIC_SHOWCASE === 'true';
const INCLUDE_WAVELENGTH_WALLET = !IS_PUBLIC_SHOWCASE_BUILD
  || import.meta.env.VITE_PUBLIC_WAVELENGTH === 'true';
const WavelengthWalletPage =
  INCLUDE_WAVELENGTH_WALLET ? lazy(() => import('./pages/WavelengthWalletPage')) : null;
const ConsensusRewardPage =
  INCLUDE_WAVELENGTH_WALLET ? lazy(() => import('./pages/ConsensusRewardPage')) : null;
const AdminTapePage =
  IS_PUBLIC_SHOWCASE_BUILD ? null : lazy(() => import('./pages/AdminTapePage').then((module) => ({ default: module.AdminTapePage })));
const AdminOperationsPage =
  IS_PUBLIC_SHOWCASE_BUILD ? null : lazy(() => import('./pages/AdminOperationsPage').then((module) => ({ default: module.AdminOperationsPage })));
const AdminSettingsPage =
  IS_PUBLIC_SHOWCASE_BUILD ? null : lazy(() => import('./pages/AdminSettingsPage').then((module) => ({ default: module.AdminSettingsPage })));
const AdminLoginPage =
  IS_PUBLIC_SHOWCASE_BUILD ? null : lazy(() => import('./pages/AdminLoginPage').then((module) => ({ default: module.AdminLoginPage })));

const walletPaymentElement = PUBLIC_SHOWCASE.allowLiveWavelength && WavelengthWalletPage ? (
  <Suspense fallback={<p className="p-8">Loading signet wallet…</p>}>
    <WavelengthWalletPage />
  </Suspense>
) : <PublicShowcaseBoundaryPage />;
const rewardWalletElement = PUBLIC_SHOWCASE.allowLiveWavelength && ConsensusRewardPage ? (
  <Suspense fallback={<p className="p-8">Loading reward wallet…</p>}>
    <ConsensusRewardPage />
  </Suspense>
) : <PublicShowcaseBoundaryPage />;
const staffTapeElement = PUBLIC_SHOWCASE.allowStaffRoutes && AdminTapePage ? (
  <Suspense fallback={<p className="p-8">Loading staff consoleâ€¦</p>}><AdminTapePage /></Suspense>
) : <PublicShowcaseBoundaryPage />;
const staffOperationsElement = PUBLIC_SHOWCASE.allowStaffRoutes && AdminOperationsPage ? (
  <Suspense fallback={<p className="p-8">Loading staff operationsâ€¦</p>}><AdminOperationsPage /></Suspense>
) : <PublicShowcaseBoundaryPage />;
const staffSettingsElement = PUBLIC_SHOWCASE.allowStaffRoutes && AdminSettingsPage ? (
  <Suspense fallback={<p className="p-8">Loading staff settingsâ€¦</p>}><AdminSettingsPage /></Suspense>
) : <PublicShowcaseBoundaryPage />;
const staffLoginElement = PUBLIC_SHOWCASE.allowStaffRoutes && AdminLoginPage ? (
  <Suspense fallback={<p className="p-8">Loading staff sign-inâ€¦</p>}><AdminLoginPage /></Suspense>
) : <PublicShowcaseBoundaryPage />;

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
            <Route path="/wallet/pay/:bookingId" element={walletPaymentElement} />
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
