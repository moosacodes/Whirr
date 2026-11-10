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
const DiscoveryStudio = lazy(() => import('./pages/DiscoveryStudio.tsx').then((module) => ({ default: module.DiscoveryStudio })));
const InvisibleCheckout = lazy(() => import('./pages/InvisibleCheckout.tsx').then((module) => ({ default: module.InvisibleCheckout })));
const Ambient = lazy(() => import('./pages/Ambient.tsx').then((module) => ({ default: module.Ambient })));
const AmbientWish = lazy(() => import('./pages/AmbientWish.tsx').then((module) => ({ default: module.AmbientWish })));
const AmbientExchange = lazy(() => import('./pages/AmbientExchange.tsx').then((module) => ({ default: module.AmbientExchange })));
const AmbientWindow = lazy(() => import('./pages/AmbientWindow.tsx').then((module) => ({ default: module.AmbientWindow })));
const AmbientAccord = lazy(() => import('./pages/AmbientAccord.tsx').then((module) => ({ default: module.AmbientAccord })));
const AmbientProofPage = lazy(() => import('./pages/AmbientProofPage.tsx').then((module) => ({ default: module.AmbientProofPage })));
const AmbientJudge = lazy(() => import('./pages/AmbientJudge.tsx').then((module) => ({ default: module.AmbientJudge })));
const AmbientOperator = lazy(() => import('./pages/AmbientOperator.tsx').then((module) => ({ default: module.AmbientOperator })));
const Promises = lazy(() => import('./pages/Promises.tsx').then((module) => ({ default: module.Promises })));
const PromiseDetail = lazy(() => import('./pages/PromiseDetail.tsx').then((module) => ({ default: module.PromiseDetail })));
const PromiseRun = lazy(() => import('./pages/PromiseRun.tsx').then((module) => ({ default: module.PromiseRun })));
const PromiseProofPage = lazy(() => import('./pages/PromiseProofPage.tsx').then((module) => ({ default: module.PromiseProofPage })));
const PromiseModel = lazy(() => import('./pages/PromiseModel.tsx').then((module) => ({ default: module.PromiseModel })));
const TeachingRoom = lazy(() => import('./pages/TeachingRoom.tsx').then((module) => ({ default: module.TeachingRoom })));
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
              <Route path="/ambient" element={<Ambient />} />
              <Route path="/ambient/judge" element={<AmbientJudge />} />
              <Route path="/ambient/wish" element={<AmbientWish />} />
              <Route path="/ambient/exchange/:agreementId" element={<AmbientExchange />} />
              <Route path="/ambient/window/:sessionId" element={<AmbientWindow />} />
              <Route path="/ambient/accord/:sessionId" element={<AmbientAccord />} />
              <Route path="/ambient/proof/:proofId" element={<AmbientProofPage />} />
              <Route path="/verify" element={<Verify />} />
              <Route path="/proof/:id" element={<Proof />} />
              <Route path="/shelf" element={<Shelf />} />
              <Route path="/invisible-checkout" element={<InvisibleCheckout />} />
              <Route path="/promise" element={<Promises />} />
              <Route path="/promise/proof/:proofId" element={<PromiseProofPage />} />
              <Route path="/promise/run/:executionId" element={<PromiseRun />} />
              <Route path="/promise/:agreementId/model" element={<PromiseModel />} />
              <Route path="/promise/:agreementId" element={<PromiseDetail />} />
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
                path="/operator/ambient"
                element={
                  <RequireOperator>
                    <AmbientOperator />
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
                path="/studio/promises"
                element={
                  <RequireOperator>
                    <TeachingRoom />
                  </RequireOperator>
                }
              />
              <Route
                path="/studio/discovery"
                element={
                  <RequireOperator>
                    <DiscoveryStudio />
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
