import { lazy, Suspense } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider, RequireOperator } from './lib/auth.tsx';
import { ScrollToTop, SiteFooter, SiteHeader } from './components/layout.tsx';
import { Loading } from './components/ui.tsx';

const Landing = lazy(() => import('./pages/Landing.tsx').then((module) => ({ default: module.Landing })));
const OperatorLogin = lazy(() => import('./pages/OperatorLogin.tsx').then((module) => ({ default: module.OperatorLogin })));
const Studio = lazy(() => import('./pages/Studio.tsx').then((module) => ({ default: module.Studio })));
const Teach = lazy(() => import('./pages/Teach.tsx').then((module) => ({ default: module.Teach })));
const ModelReview = lazy(() => import('./pages/ModelReview.tsx').then((module) => ({ default: module.ModelReview })));
const GateA = lazy(() => import('./pages/GateA.tsx').then((module) => ({ default: module.GateA })));
const CalibrationLab = lazy(() => import('./pages/CalibrationLab.tsx').then((module) => ({ default: module.CalibrationLab })));
const FieldReportPage = lazy(() => import('./pages/FieldReport.tsx').then((module) => ({ default: module.FieldReportPage })));
const Pricing = lazy(() => import('./pages/Pricing.tsx').then((module) => ({ default: module.Pricing })));
const ServiceCardPage = lazy(() => import('./pages/ServiceCardPage.tsx').then((module) => ({ default: module.ServiceCardPage })));
const RenterService = lazy(() => import('./pages/RenterService.tsx').then((module) => ({ default: module.RenterService })));
const LiveSession = lazy(() => import('./pages/LiveSession.tsx').then((module) => ({ default: module.LiveSession })));
const ReviewPage = lazy(() => import('./pages/Review.tsx').then((module) => ({ default: module.ReviewPage })));
const ReceiptPage = lazy(() => import('./pages/Receipt.tsx').then((module) => ({ default: module.ReceiptPage })));
const Passport = lazy(() => import('./pages/Passport.tsx').then((module) => ({ default: module.Passport })));
const OperatorConsole = lazy(() => import('./pages/OperatorConsole.tsx').then((module) => ({ default: module.OperatorConsole })));
const Judge = lazy(() => import('./pages/Judge.tsx').then((module) => ({ default: module.Judge })));
const OfflineDemo = lazy(() => import('./pages/OfflineDemo.tsx').then((module) => ({ default: module.OfflineDemo })));
const Verify = lazy(() => import('./pages/Verify.tsx').then((module) => ({ default: module.Verify })));
const Proof = lazy(() => import('./pages/Proof.tsx').then((module) => ({ default: module.Proof })));
const Replay = lazy(() => import('./pages/Replay.tsx').then((module) => ({ default: module.Replay })));
const Shelf = lazy(() => import('./pages/Shelf.tsx').then((module) => ({ default: module.Shelf })));
const Poster = lazy(() => import('./pages/Poster.tsx').then((module) => ({ default: module.Poster })));
const NotFound = lazy(() => import('./pages/NotFound.tsx').then((module) => ({ default: module.NotFound })));

export function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <ScrollToTop />
        <div className="site">
          <a className="skip-link" href="#main">
            Skip to content
          </a>
          <SiteHeader />
          <main id="main">
            <Suspense fallback={<Loading label="Loading page…" />}>
              <Routes>
              <Route path="/" element={<Landing />} />
              <Route path="/judge" element={<Judge />} />
              <Route path="/verify" element={<Verify />} />
              <Route path="/proof/:id" element={<Proof />} />
              <Route path="/shelf" element={<Shelf />} />
              <Route path="/demo/offline" element={<OfflineDemo />} />
              <Route path="/operator/login" element={<OperatorLogin />} />
              <Route path="/s/:objectId" element={<RenterService />} />
              <Route path="/passport/:objectId" element={<Passport />} />
              <Route path="/field-report/:reportId" element={<FieldReportPage />} />
              <Route path="/session/:id" element={<LiveSession />} />
              <Route path="/session/:id/replay" element={<Replay />} />
              <Route path="/session/:id/review" element={<ReviewPage />} />
              <Route path="/receipt/:id" element={<ReceiptPage />} />
              <Route
                path="/operator"
                element={
                  <RequireOperator>
                    <OperatorConsole />
                  </RequireOperator>
                }
              />
              <Route
                path="/studio"
                element={
                  <RequireOperator>
                    <Studio />
                  </RequireOperator>
                }
              />
              <Route
                path="/studio/objects/:objectId"
                element={
                  <RequireOperator>
                    <Teach />
                  </RequireOperator>
                }
              />
              <Route
                path="/studio/objects/:objectId/model"
                element={
                  <RequireOperator>
                    <ModelReview />
                  </RequireOperator>
                }
              />
              <Route
                path="/studio/objects/:objectId/gate-a"
                element={
                  <RequireOperator>
                    <GateA />
                  </RequireOperator>
                }
              />
              <Route
                path="/studio/objects/:objectId/calibration-lab"
                element={
                  <RequireOperator>
                    <CalibrationLab />
                  </RequireOperator>
                }
              />
              <Route
                path="/studio/objects/:objectId/pricing"
                element={
                  <RequireOperator>
                    <Pricing />
                  </RequireOperator>
                }
              />
              <Route
                path="/studio/objects/:objectId/card"
                element={
                  <RequireOperator>
                    <ServiceCardPage />
                  </RequireOperator>
                }
              />
              <Route
                path="/studio/objects/:objectId/poster"
                element={
                  <RequireOperator>
                    <Poster />
                  </RequireOperator>
                }
              />
              <Route path="*" element={<NotFound />} />
              </Routes>
            </Suspense>
          </main>
          <SiteFooter />
        </div>
      </BrowserRouter>
    </AuthProvider>
  );
}
