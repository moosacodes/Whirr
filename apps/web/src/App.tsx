import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider, RequireOperator } from './lib/auth.tsx';
import { ScrollToTop, SiteFooter, SiteHeader } from './components/layout.tsx';
import { Landing } from './pages/Landing.tsx';
import { OperatorLogin } from './pages/OperatorLogin.tsx';
import { Studio } from './pages/Studio.tsx';
import { Teach } from './pages/Teach.tsx';
import { ModelReview } from './pages/ModelReview.tsx';
import { Pricing } from './pages/Pricing.tsx';
import { ServiceCardPage } from './pages/ServiceCardPage.tsx';
import { RenterService } from './pages/RenterService.tsx';
import { LiveSession } from './pages/LiveSession.tsx';
import { ReviewPage } from './pages/Review.tsx';
import { ReceiptPage } from './pages/Receipt.tsx';
import { Passport } from './pages/Passport.tsx';
import { OperatorConsole } from './pages/OperatorConsole.tsx';
import { Judge } from './pages/Judge.tsx';
import { OfflineDemo } from './pages/OfflineDemo.tsx';
import { Verify } from './pages/Verify.tsx';
import { Proof } from './pages/Proof.tsx';
import { Replay } from './pages/Replay.tsx';
import { Shelf } from './pages/Shelf.tsx';
import { Poster } from './pages/Poster.tsx';
import { NotFound } from './pages/NotFound.tsx';

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
          </main>
          <SiteFooter />
        </div>
      </BrowserRouter>
    </AuthProvider>
  );
}
