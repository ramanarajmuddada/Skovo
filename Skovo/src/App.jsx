import React, { lazy, Suspense } from 'react';
import PublicShell from './components/layout/PublicShell';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { ToastProvider } from './components/ui/index.jsx';
import { useAuth } from './context/AuthContext';
import { isAdminHost } from './utils/portalHost';

/* ── Two builds from one source ────────────────────────────────────────
   VITE_PORTAL picks what goes in the bundle:
     'web'   -> skovoai.com  : students, achievers and public pages
     'admin' -> skovoai.info : the staff console, admin and super-admin portals
     unset   -> everything (local dev, where both sites share localhost)
   Vite inlines the value at build time, so the other side's routes and their
   lazy chunks are dropped from the output rather than merely hidden. */
const PORTAL    = import.meta.env.VITE_PORTAL; // literal at build time, so dead branches fold away
const SHOW_WEB   = PORTAL !== 'admin';
const SHOW_ADMIN = PORTAL !== 'web';

/* ── Lazy page imports ────────────────────────────────────────────────── */

// Public
const LandingPage   = /* @__PURE__ */ lazy(() => import('./pages/LandingPage'));
const Login         = /* @__PURE__ */ lazy(() => import('./pages/Login'));
const SignUp        = /* @__PURE__ */ lazy(() => import('./pages/SignUp'));
const VerifyEmail   = /* @__PURE__ */ lazy(() => import('./pages/VerifyEmail'));
const ForgotPassword = /* @__PURE__ */ lazy(() => import('./pages/ForgotPassword'));
const AcceptInvite  = /* @__PURE__ */ lazy(() => import('./pages/AcceptInvite'));
const NotFound      = /* @__PURE__ */ lazy(() => import('./pages/NotFound'));
const ConsentGate   = /* @__PURE__ */ lazy(() => import('./pages/ConsentGate'));
const ParentConsent = /* @__PURE__ */ lazy(() => import('./pages/ParentConsent'));

// Legal / policy pages — public, reachable signed-out. Cashfree and AWS SES
// both fetch these during review, so they must resolve without a session.
const Terms   = /* @__PURE__ */ lazy(() => import('./pages/legal/Terms'));
const Privacy = /* @__PURE__ */ lazy(() => import('./pages/legal/Privacy'));
const Refund  = /* @__PURE__ */ lazy(() => import('./pages/legal/Refund'));
const Contact = /* @__PURE__ */ lazy(() => import('./pages/legal/Contact'));
const PricingPage = /* @__PURE__ */ lazy(() => import('./pages/legal/Pricing'));

// Student app
const MainLayout              = /* @__PURE__ */ lazy(() => import('./components/layout/MainLayout'));
const Dashboard               = /* @__PURE__ */ lazy(() => import('./pages/Dashboard'));
const BhaAI                   = /* @__PURE__ */ lazy(() => import('./pages/BhaAI'));
const Cohorts                 = /* @__PURE__ */ lazy(() => import('./pages/Cohorts'));
const OneOnOnes               = /* @__PURE__ */ lazy(() => import('./pages/OneOnOnes'));
const Colleges                = /* @__PURE__ */ lazy(() => import('./pages/Colleges'));
const SavedColleges           = /* @__PURE__ */ lazy(() => import('./pages/SavedColleges'));
const CollegePredictor        = /* @__PURE__ */ lazy(() => import('./pages/CollegePredictor'));
const CollegeDetails          = /* @__PURE__ */ lazy(() => import('./pages/CollegeDetails'));
const Opportunities           = /* @__PURE__ */ lazy(() => import('./pages/Opportunities'));
const Applications            = /* @__PURE__ */ lazy(() => import('./pages/Applications'));
const Assemble                = /* @__PURE__ */ lazy(() => import('./pages/Assemble'));
const Coaching                = /* @__PURE__ */ lazy(() => import('./pages/Coaching'));
const Profile                 = /* @__PURE__ */ lazy(() => import('./pages/Profile'));
const FindMentors             = /* @__PURE__ */ lazy(() => import('./pages/FindMentors'));
const AchieverPublicProfile   = /* @__PURE__ */ lazy(() => import('./pages/AchieverPublicProfile'));
// v1-hidden: const ReadinessAssessment     = /* @__PURE__ */ lazy(() => import('./pages/ReadinessAssessment'));
const Bookings                = /* @__PURE__ */ lazy(() => import('./pages/Bookings'));
const PaymentHistory          = /* @__PURE__ */ lazy(() => import('./pages/PaymentHistory'));
const SkovoPro                = /* @__PURE__ */ lazy(() => import('./pages/SkovoPro'));
const Tasks                   = /* @__PURE__ */ lazy(() => import('./pages/Tasks'));
const Notifications           = /* @__PURE__ */ lazy(() => import('./pages/Notifications'));
const HelpSupport             = /* @__PURE__ */ lazy(() => import('./pages/HelpSupport'));
const Roadmap                 = /* @__PURE__ */ lazy(() => import('./pages/Roadmap'));
const CGHub                   = /* @__PURE__ */ lazy(() => import('./pages/CGHub'));
const CGEntranceExams         = /* @__PURE__ */ lazy(() => import('./pages/CGEntranceExams'));
const CGScholarships          = /* @__PURE__ */ lazy(() => import('./pages/CGScholarships'));
const CGGovtExams             = /* @__PURE__ */ lazy(() => import('./pages/CGGovtExams'));
const CGAbroad                = /* @__PURE__ */ lazy(() => import('./pages/CGAbroad'));
const CGBranches              = /* @__PURE__ */ lazy(() => import('./pages/CGBranches'));
const MockTests               = /* @__PURE__ */ lazy(() => import('./pages/MockTests'));
const CollegeApplicationTracker = /* @__PURE__ */ lazy(() => import('./pages/CollegeApplicationTracker'));
const Forum                   = /* @__PURE__ */ lazy(() => import('./pages/Forum'));
const ScholarshipTracker      = /* @__PURE__ */ lazy(() => import('./pages/ScholarshipTracker'));
const ResumeBuilder           = /* @__PURE__ */ lazy(() => import('./pages/ResumeBuilder'));
const ExamResources           = /* @__PURE__ */ lazy(() => import('./pages/ExamResources'));
const DocumentVault           = /* @__PURE__ */ lazy(() => import('./pages/DocumentVault'));
const Market                  = /* @__PURE__ */ lazy(() => import('./pages/Market'));
const ScoreEngine             = /* @__PURE__ */ lazy(() => import('./pages/ScoreEngine'));
const SOPBuilder              = /* @__PURE__ */ lazy(() => import('./pages/SOPBuilder'));
const Certifications          = /* @__PURE__ */ lazy(() => import('./pages/Certifications'));
const Leaderboard             = /* @__PURE__ */ lazy(() => import('./pages/Leaderboard'));
const StreakPage              = /* @__PURE__ */ lazy(() => import('./pages/v1/Streak'));
const Practice                = /* @__PURE__ */ lazy(() => import('./pages/v1/Practice'));
const WalletPage              = /* @__PURE__ */ lazy(() => import('./pages/v1/Wallet'));
const ParentView              = /* @__PURE__ */ lazy(() => import('./pages/v1/ParentView'));
const Referrals               = /* @__PURE__ */ lazy(() => import('./pages/Referrals'));

// Admin portal
import ConsoleLanding from './components/layout/ConsoleLanding';
const AdminLogin          = /* @__PURE__ */ lazy(() => import('./pages/admin/AdminLogin'));
const AdminLayout         = /* @__PURE__ */ lazy(() => import('./pages/admin/AdminLayout'));
const AdminDashboard      = /* @__PURE__ */ lazy(() => import('./pages/admin/AdminDashboard'));
const AdminUsers          = /* @__PURE__ */ lazy(() => import('./pages/admin/AdminUsers'));
const AdminStudentDetail  = /* @__PURE__ */ lazy(() => import('./pages/admin/AdminStudentDetail'));
const AdminCohorts        = /* @__PURE__ */ lazy(() => import('./pages/admin/AdminCohorts'));
const AdminColleges       = /* @__PURE__ */ lazy(() => import('./pages/admin/AdminColleges'));
const AdminOpportunities  = /* @__PURE__ */ lazy(() => import('./pages/admin/AdminOpportunities'));
const AdminAchievers      = /* @__PURE__ */ lazy(() => import('./pages/admin/AdminAchievers'));
const AdminAchieverLifecycle = /* @__PURE__ */ lazy(() => import('./pages/admin/AdminAchieverLifecycle'));
const AdminDomains        = /* @__PURE__ */ lazy(() => import('./pages/admin/AdminDomains'));
const AdminMasters        = /* @__PURE__ */ lazy(() => import('./pages/admin/AdminMasters'));
const AdminCities         = /* @__PURE__ */ lazy(() => import('./pages/admin/AdminCities'));
const AdminCourseCatalogue = /* @__PURE__ */ lazy(() => import('./pages/admin/AdminCourseCatalogue'));
const AdminImport         = /* @__PURE__ */ lazy(() => import('./pages/admin/AdminImport'));
const AdminCoaching       = /* @__PURE__ */ lazy(() => import('./pages/admin/AdminCoaching'));
const AdminInvites        = /* @__PURE__ */ lazy(() => import('./pages/admin/AdminInvites'));
const AdminAudit          = /* @__PURE__ */ lazy(() => import('./pages/admin/AdminAudit'));
const AdminBookings       = /* @__PURE__ */ lazy(() => import('./pages/admin/AdminBookings'));
const AdminPayments       = /* @__PURE__ */ lazy(() => import('./pages/admin/AdminPayments'));
const AdminTasks          = /* @__PURE__ */ lazy(() => import('./pages/admin/AdminTasks'));
const AdminReadinessRules = /* @__PURE__ */ lazy(() => import('./pages/admin/AdminReadinessRules'));
const AdminProfile        = /* @__PURE__ */ lazy(() => import('./pages/admin/AdminProfile'));
const AdminAnalytics      = /* @__PURE__ */ lazy(() => import('./pages/admin/AdminAnalytics'));
const AdminCGColleges     = /* @__PURE__ */ lazy(() => import('./pages/admin/AdminCGColleges'));
const AdminCGEntranceExams = /* @__PURE__ */ lazy(() => import('./pages/admin/AdminCGEntranceExams'));
const AdminCGScholarships  = /* @__PURE__ */ lazy(() => import('./pages/admin/AdminCGScholarships'));
const AdminCGGovtExams     = /* @__PURE__ */ lazy(() => import('./pages/admin/AdminCGGovtExams'));
const AdminCGAbroad        = /* @__PURE__ */ lazy(() => import('./pages/admin/AdminCGAbroad'));
const AdminCGBranches      = /* @__PURE__ */ lazy(() => import('./pages/admin/AdminCGBranches'));
const AdminCGRankData      = /* @__PURE__ */ lazy(() => import('./pages/admin/AdminCGRankData'));
const AdminCGContent       = /* @__PURE__ */ lazy(() => import('./pages/admin/AdminCGContent'));
const AdminCGAIPrompts     = /* @__PURE__ */ lazy(() => import('./pages/admin/AdminCGAIPrompts'));
const AdminErrorLogs       = /* @__PURE__ */ lazy(() => import('./pages/admin/AdminErrorLogs'));
const AdminMockTests          = /* @__PURE__ */ lazy(() => import('./pages/admin/AdminMockTests'));
const AdminExamResources      = /* @__PURE__ */ lazy(() => import('./pages/admin/AdminExamResources'));
const AdminCourses            = /* @__PURE__ */ lazy(() => import('./pages/admin/AdminCourses'));
const AdminCommunities        = /* @__PURE__ */ lazy(() => import('./pages/admin/AdminCommunities'));
const AdminCollegeReviews     = /* @__PURE__ */ lazy(() => import('./pages/admin/AdminCollegeReviews'));
const AdminReferrals          = /* @__PURE__ */ lazy(() => import('./pages/admin/AdminReferrals'));
const AdminCoupons            = /* @__PURE__ */ lazy(() => import('./pages/admin/AdminCoupons'));
const AdminSubscriptions      = /* @__PURE__ */ lazy(() => import('./pages/admin/AdminSubscriptions'));
const AdminMarket             = /* @__PURE__ */ lazy(() => import('./pages/admin/AdminMarket'));
const AdminScoreRules         = /* @__PURE__ */ lazy(() => import('./pages/admin/AdminScoreRules'));
const AdminModeration         = /* @__PURE__ */ lazy(() => import('./pages/admin/AdminModeration'));
const AdminSupport            = /* @__PURE__ */ lazy(() => import('./pages/admin/AdminSupport'));
// Version 1 (feature-updates.md)
const AdminStages          = /* @__PURE__ */ lazy(() => import('./pages/admin/AdminStages'));
const AdminStreaks         = /* @__PURE__ */ lazy(() => import('./pages/admin/AdminStreaks'));
const AdminAchieverGuidelines = /* @__PURE__ */ lazy(() => import('./pages/admin/AdminAchieverGuidelines'));
const AdminReadinessV21    = /* @__PURE__ */ lazy(() => import('./pages/admin/AdminReadinessV21'));
const AdminLeaderboard     = /* @__PURE__ */ lazy(() => import('./pages/admin/AdminLeaderboard'));
const AdminEngagement      = /* @__PURE__ */ lazy(() => import('./pages/admin/AdminEngagement'));
const AdminWallet          = /* @__PURE__ */ lazy(() => import('./pages/admin/AdminWallet'));
const AdminCommunitySafety = /* @__PURE__ */ lazy(() => import('./pages/admin/AdminCommunitySafety'));
const AdminPlatformV1      = /* @__PURE__ */ lazy(() => import('./pages/admin/AdminPlatformV1'));

// Super admin portal
const SuperLogin          = /* @__PURE__ */ lazy(() => import('./pages/super/SuperLogin'));
const SuperLayout         = /* @__PURE__ */ lazy(() => import('./pages/super/SuperLayout'));
const SuperDashboard      = /* @__PURE__ */ lazy(() => import('./pages/super/SuperDashboard'));
const SuperAdmins         = /* @__PURE__ */ lazy(() => import('./pages/super/SuperAdmins'));
const SuperBusinessDashboard = /* @__PURE__ */ lazy(() => import('./pages/super/SuperBusinessDashboard'));
const SuperAdminApprovals    = /* @__PURE__ */ lazy(() => import('./pages/super/SuperAdminApprovals'));
const SuperUsers          = /* @__PURE__ */ lazy(() => import('./pages/super/SuperUsers'));
const SuperMentors        = /* @__PURE__ */ lazy(() => import('./pages/super/SuperMentors'));
const SuperCohorts        = /* @__PURE__ */ lazy(() => import('./pages/super/SuperCohorts'));
const SuperAuditLog       = /* @__PURE__ */ lazy(() => import('./pages/super/SuperAuditLog'));
const SuperOpportunities  = /* @__PURE__ */ lazy(() => import('./pages/super/SuperOpportunities'));
const SuperCommunities    = /* @__PURE__ */ lazy(() => import('./pages/super/SuperCommunities'));
const SuperCourses        = /* @__PURE__ */ lazy(() => import('./pages/super/SuperCourses'));
const SuperEnrollments    = /* @__PURE__ */ lazy(() => import('./pages/super/SuperEnrollments'));
const SuperReadiness      = /* @__PURE__ */ lazy(() => import('./pages/super/SuperReadiness'));
const SuperV1Overview   = /* @__PURE__ */ lazy(() => import('./pages/super/SuperV1Overview'));
const SuperProfile        = /* @__PURE__ */ lazy(() => import('./pages/super/SuperProfile'));

// Achiever portal
const AchieverLogin          = /* @__PURE__ */ lazy(() => import('./pages/achiever/AchieverLogin'));
const AchieverRegister       = /* @__PURE__ */ lazy(() => import('./pages/achiever/AchieverRegister'));
const AchieverVerifyOTP      = /* @__PURE__ */ lazy(() => import('./pages/achiever/AchieverVerifyOTP'));
const AchieverForgotPassword = /* @__PURE__ */ lazy(() => import('./pages/achiever/AchieverForgotPassword'));
const AchieverLayout       = /* @__PURE__ */ lazy(() => import('./pages/achiever/AchieverLayout'));
const AchieverDashboard    = /* @__PURE__ */ lazy(() => import('./pages/achiever/AchieverDashboard'));
const AchieverBookings     = /* @__PURE__ */ lazy(() => import('./pages/achiever/AchieverBookings'));
const AchieverCohorts      = /* @__PURE__ */ lazy(() => import('./pages/achiever/AchieverCohorts'));
const AchieverTasks       = /* @__PURE__ */ lazy(() => import('./pages/achiever/AchieverTasks'));
const AchieverReviewQueue  = /* @__PURE__ */ lazy(() => import('./pages/achiever/AchieverReviewQueue'));
const AchieverAvailability = /* @__PURE__ */ lazy(() => import('./pages/achiever/AchieverAvailability'));
const AchieverEarnings     = /* @__PURE__ */ lazy(() => import('./pages/achiever/AchieverEarnings'));
const AchieverReferrals    = /* @__PURE__ */ lazy(() => import('./pages/achiever/AchieverReferrals'));
const AchieverProfile      = /* @__PURE__ */ lazy(() => import('./pages/achiever/AchieverProfile'));
const AchieverApplication  = /* @__PURE__ */ lazy(() => import('./pages/achiever/AchieverApplication'));
const AchieverNotifications = /* @__PURE__ */ lazy(() => import('./pages/achiever/AchieverNotifications'));
// const AchieverDomains      = /* @__PURE__ */ lazy(() => import('./pages/achiever/AchieverDomains'));  // v1: hidden
// v1-hidden: achiever courses
// const AchieverCourses      = /* @__PURE__ */ lazy(() => import('./pages/achiever/AchieverCourses'));
// v1: no coupon codes; Offers replaces the Coupons screen.
const AchieverOffers       = /* @__PURE__ */ lazy(() => import('./pages/achiever/AchieverOffers'));
const AchieverHelpSupport  = /* @__PURE__ */ lazy(() => import('./pages/achiever/AchieverHelpSupport'));

// v1-hidden: student courses
// v1-hidden: const Courses              = /* @__PURE__ */ lazy(() => import('./pages/Courses'));

/* ── Loading fallback ─────────────────────────────────────────────────── */
function PageLoader() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="flex flex-col items-center gap-4">
        <div className="w-10 h-10 rounded-xl overflow-hidden shadow-lg animate-pulse">
          <img src="/skovo-logo-blue.jpg" alt="Skovo" className="w-full h-full object-cover" />
        </div>
        <div className="flex gap-1.5">
          <span className="w-2 h-2 rounded-full bg-indigo-600 animate-bounce" style={{ animationDelay: '0ms' }} />
          <span className="w-2 h-2 rounded-full bg-indigo-400 animate-bounce" style={{ animationDelay: '150ms' }} />
          <span className="w-2 h-2 rounded-full bg-violet-400 animate-bounce" style={{ animationDelay: '300ms' }} />
        </div>
      </div>
    </div>
  );
}

/* Old achiever emails linked to skovoai.com/achiever/<page>. The achiever portal
   now lives on this same (web) site, so send them straight to the same page. */
function OldAchieverLink() {
  const rest = window.location.pathname.replace(/^\/achiever\/?/, '');
  return <Navigate to={`/skovo-achiever-portal/${rest}${window.location.search}`} replace />;
}

/* On the web site the staff-portal paths belong to the admin domain. Anyone who
   follows an old link or types one here is sent across, path and query intact. */
function ToAdminSite() {
  const host = (import.meta.env.VITE_ADMIN_HOST || '').trim();
  const { pathname, search } = window.location;
  if (host) { window.location.replace(`https://${host}${pathname}${search}`); return <PageLoader />; }
  return <NotFound />;
}

/* ── Route guards ─────────────────────────────────────────────────────── */
function HomeRoute() {
  const { user } = useAuth();

  // One bundle serves two hostnames. On the admin domain (skovoai.info) the
  // root is the admin console's landing page — never the student one, and never
  // the student dashboard redirect, since a student session in this browser
  // says nothing about who is standing at the admin door.
  if (PORTAL === 'admin' || (PORTAL !== 'web' && isAdminHost())) return <ConsoleLanding />;

  return user ? <Navigate to="/career-path" replace /> : <LandingPage />;
}

function ProtectedRoute({ children }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function AdminRoute({ children }) {
  return (
    <ConsoleGuard
      tokenKey="admin_access_token"
      base="/skovo-platform-panel-admin"
      landing={<Navigate to="/console" replace />}
    >
      {children}
    </ConsoleGuard>
  );
}

// Logged in: the normal app (sidebar). Logged out: a light public shell, so
// a shared achiever link shows the profile instead of a login wall.
function MaybeAppLayout() {
  const { user } = useAuth();
  return user ? <MainLayout /> : <PublicShell />;
}

function GuestRoute({ children }) {
  const { user } = useAuth();
  if (user) return <Navigate to="/career-path" replace />;
  return children;
}

function SuperRoute({ children }) {
  return (
    <ConsoleGuard
      tokenKey="super_access_token"
      base="/skovo-platform-owner"
      landing={<Navigate to="/console" replace />}
    >
      {children}
    </ConsoleGuard>
  );
}

/**
 * Console access guard.
 *
 * Signed in  → the console.
 * Signed out at the ROOT (/skovo-platform-owner) → that console's entry page.
 * Signed out anywhere DEEPER (.../cohorts) → straight to the login form.
 *
 * The last distinction is deliberate. Someone typing the bare console URL is
 * arriving and deserves to be told where they are. Someone who followed a link
 * to .../cohorts already knows, and wants the thing they asked for — a landing
 * page in front of it is an obstacle, not a welcome.
 *
 * NOTE: this only checks that a token EXISTS, not that it is still valid. That
 * is pre-existing on all four portals and is a nuisance rather than a hole: an
 * expired token gets past here and the API answers 401 on the first request.
 * The real check is server-side, on every call.
 */
function ConsoleGuard({ tokenKey, base, landing, children }) {
  const token = localStorage.getItem(tokenKey);
  const { pathname } = useLocation();
  if (token) return children;
  const atRoot = pathname === base || pathname === `${base}/`;
  return atRoot ? landing : <Navigate to={`${base}/login`} replace />;
}

function AchieverRoute({ children }) {
  const token = localStorage.getItem('achiever_access_token');
  if (!token) return <Navigate to="/skovo-achiever-portal/login" replace />;
  return children;
}

/* ── App ──────────────────────────────────────────────────────────────── */
function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<PageLoader />}>
        <Routes>
          {/* Landing page — public, redirects to app if authenticated */}
          <Route path="/" element={<HomeRoute />} />
          {SHOW_WEB && (<>

          {/* Invite acceptance — public */}
          <Route path="/invite/:token" element={<AcceptInvite />} />
          <Route path="/consent" element={<ConsentGate />} />
          <Route path="/parent-consent" element={<ParentConsent />} />

          {/* Legal / policy pages — public, no auth guard */}
          <Route path="/terms"   element={<Terms />} />
          <Route path="/privacy" element={<Privacy />} />
          <Route path="/parent"  element={<ParentView />} />
          <Route path="/refund"  element={<Refund />} />
          <Route path="/contact" element={<Contact />} />
          <Route path="/pricing" element={<PricingPage />} />

          {/* Auth routes — redirect to app if already logged in */}
          <Route path="/login"           element={<GuestRoute><Login /></GuestRoute>} />
          <Route path="/signup"          element={<GuestRoute><SignUp /></GuestRoute>} />
          <Route path="/verify-email"    element={<VerifyEmail />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />

          {/* ── Achiever profile: shared links open without login ── */}
          <Route element={<MaybeAppLayout />}>
            <Route path="/achievers/:achieverId" element={<AchieverPublicProfile />} />
          </Route>

          {/* ── Student app — pathless layout route (protected) ── */}
          <Route element={<ProtectedRoute><MainLayout /></ProtectedRoute>}>
            <Route path="/career-path"                   element={<Dashboard />} />
            {/* v2 module — the screen explains that, so the nav item leads somewhere. */}
            <Route path="/bhaai"                         element={<BhaAI />} />
            <Route path="/cohorts"                       element={<Cohorts />} />
            <Route path="/one-on-one"                    element={<OneOnOnes />} />
            <Route path="/colleges"                      element={<Colleges />} />
            <Route path="/colleges/saved"                element={<SavedColleges />} />
            {/* The predictor is a tab inside Colleges now, so it lives under
                /colleges/* — that is also what keeps the "Colleges" sidebar item
                lit while it is open (MainLayout matches on path prefix). */}
            <Route path="/colleges/predictor"            element={<CollegePredictor />} />
            {/* Old top-level path — bookmarks and any link already in the wild. */}
            <Route path="/college-predictor"             element={<Navigate to="/colleges/predictor" replace />} />
            <Route path="/colleges/:id"                  element={<CollegeDetails />} />
            <Route path="/opportunities"                 element={<Opportunities />} />
            <Route path="/applications"                  element={<Applications />} />
            <Route path="/assemble"                      element={<Assemble />} />
            {/* v1-hidden: <Route path="/coaching"                      element={<Coaching />} /> */}
            <Route path="/profile"                       element={<Profile />} />
            <Route path="/find-mentors"                  element={<FindMentors />} />
            {/* v1-hidden: <Route path="/readiness-assessment"          element={<ReadinessAssessment />} /> */}
            <Route path="/bookings"                      element={<Bookings />} />
            <Route path="/payments"                      element={<PaymentHistory />} />
            <Route path="/skovo-pro"                     element={<SkovoPro />} />
            <Route path="/tasks"                         element={<Tasks />} />
            <Route path="/notifications"                 element={<Notifications />} />
            <Route path="/support"                       element={<HelpSupport />} />
            {/* v1-hidden: <Route path="/roadmap"                       element={<Roadmap />} /> */}
            {/* v1-hidden: <Route path="/career-guidance"               element={<CGHub />} /> */}
            {/* v1-hidden: <Route path="/career-guidance/entrance-exams" element={<CGEntranceExams />} /> */}
            {/* v1-hidden: <Route path="/career-guidance/scholarships"  element={<CGScholarships />} /> */}
            {/* v1-hidden: <Route path="/career-guidance/govt-exams"    element={<CGGovtExams />} /> */}
            {/* v1-hidden: <Route path="/career-guidance/abroad"        element={<CGAbroad />} /> */}
            {/* v1-hidden: <Route path="/career-guidance/branches"      element={<CGBranches />} /> */}
            {/* v1-hidden: <Route path="/mock-tests"                    element={<MockTests />} /> */}
            {/* v1-hidden: <Route path="/college-applications"          element={<CollegeApplicationTracker />} /> */}
            {/* v1-hidden: <Route path="/forum"                         element={<Forum />} /> */}
            {/* v1-hidden: <Route path="/scholarship-tracker"           element={<ScholarshipTracker />} /> */}
            {/* v1-hidden: <Route path="/resume-builder"                element={<ResumeBuilder />} /> */}
            {/* v1-hidden: <Route path="/exam-resources"                element={<ExamResources />} /> */}
            <Route path="/document-vault"                element={<DocumentVault />} />
            <Route path="/market"                        element={<Market />} />
            <Route path="/my-score"                      element={<ScoreEngine />} />
            {/* v1-hidden: <Route path="/sop-builder"                   element={<SOPBuilder />} /> */}
            {/* v1-hidden: <Route path="/certifications"                element={<Certifications />} /> */}
            <Route path="/leaderboard"                   element={<Leaderboard />} />
            <Route path="/streak"                        element={<StreakPage />} />
            <Route path="/practice"                      element={<Practice />} />
            <Route path="/wallet"                        element={<WalletPage />} />
            {/* v1-hidden: <Route path="/courses"                       element={<Courses />} /> */}
            <Route path="/referrals"                     element={<Referrals />} />
          </Route>

          {/* ── Achiever portal ──────────────────────────────── */}
          <Route path="/achiever/*" element={<OldAchieverLink />} />
          <Route path="/skovo-achiever-portal/login"            element={<AchieverLogin />} />
          <Route path="/skovo-achiever-portal/register"         element={<AchieverRegister />} />
          <Route path="/skovo-achiever-portal/verify-otp"       element={<AchieverVerifyOTP />} />
          <Route path="/skovo-achiever-portal/forgot-password"  element={<AchieverForgotPassword />} />
          <Route
            path="/skovo-achiever-portal"
            element={<AchieverRoute><AchieverLayout /></AchieverRoute>}
          >
            <Route index element={<AchieverDashboard />} />
            <Route path="bookings"     element={<AchieverBookings />} />
            <Route path="cohorts"      element={<AchieverCohorts />} />
            <Route path="tasks"        element={<AchieverTasks />} />
            <Route path="review-queue" element={<AchieverReviewQueue />} />
            <Route path="availability" element={<AchieverAvailability />} />
            <Route path="earnings"     element={<AchieverEarnings />} />
            {/* v1: Domains screen hidden; domains are picked in Create cohort.
            <Route path="domains"      element={<AchieverDomains />} /> */}
            {/* v1-hidden: <Route path="courses"      element={<AchieverCourses />} /> */}
            <Route path="offers"       element={<AchieverOffers />} />
            <Route path="coupons"      element={<Navigate to="/skovo-achiever-portal/offers" replace />} />
            <Route path="profile"      element={<AchieverProfile />} />
            <Route path="application"  element={<AchieverApplication />} />
            <Route path="notifications" element={<AchieverNotifications />} />
            <Route path="support"       element={<AchieverHelpSupport />} />
            <Route path="referrals"     element={<AchieverReferrals />} />
          </Route>

          {PORTAL === 'web' && (<>
          {/* Staff-portal paths on the web site go to the admin domain. */}
          <Route path="/console" element={<ToAdminSite />} />
          <Route path="/skovo-platform-panel-admin/*" element={<ToAdminSite />} />
          <Route path="/skovo-platform-owner/*" element={<ToAdminSite />} />
          </>)}
          </>)}

          {SHOW_ADMIN && (<>
          {/* ── Admin portal ─────────────────────────────────── */}
          {/* Landing — public. Also what the admin domain's root renders (see
              HomeRoute); the explicit path keeps it reachable in dev, where
              both sites share localhost. */}
          {/* The console chooser. Its own route so it works on localhost too:
              isAdminHost() keys off the hostname, and localhost is not
              skovoai.info, so without this there is no way to open the
              chooser in dev. */}
          <Route path="/console" element={<ConsoleLanding />} />
          <Route path="/skovo-platform-panel-admin/home"            element={<Navigate to="/console" replace />} />
          <Route path="/skovo-platform-panel-admin/setup"           element={<Navigate to="/signup" replace />} />
          <Route path="/skovo-platform-panel-admin/login"           element={<AdminLogin />} />
          <Route path="/skovo-platform-panel-admin/register"        element={<Navigate to="/skovo-platform-panel-admin/login" replace />} />
          <Route path="/skovo-platform-panel-admin/verify-otp"      element={<Navigate to="/skovo-platform-panel-admin/login" replace />} />
          <Route path="/skovo-platform-panel-admin/forgot-password" element={<Navigate to="/skovo-platform-panel-admin/login" replace />} />
          {/* ToastProvider: useToast() falls back to silent no-ops when no
              provider is mounted, so every admin toast -- approve, reject,
              suspend, ban -- did nothing at all. Only AchieverLayout had one.
              5s matches the achiever portal. */}
          <Route
            path="/skovo-platform-panel-admin"
            element={<AdminRoute><ToastProvider duration={5000}><AdminLayout /></ToastProvider></AdminRoute>}
          >
            <Route index element={<AdminDashboard />} />
            <Route path="users"            element={<AdminUsers />} />
            <Route path="users/:id"        element={<AdminStudentDetail />} />
            <Route path="cohorts"          element={<AdminCohorts />} />
            <Route path="colleges"         element={<AdminColleges />} />
            <Route path="opportunities"    element={<AdminOpportunities />} />
            <Route path="achievers"        element={<AdminAchievers />} />
            <Route path="achiever-guidelines" element={<AdminAchieverGuidelines />} />
            {/* Replaces the trust-tier dropdown: applications and probation
                decisions in one queue, driven by evidence rather than a level. */}
            <Route path="achiever-review"  element={<AdminAchieverLifecycle />} />
            <Route path="domains"          element={<AdminDomains />} />
            <Route path="masters"          element={<AdminMasters />} />
            <Route path="cities"           element={<AdminCities />} />
            <Route path="course-catalogue" element={<AdminCourseCatalogue />} />
            <Route path="import"           element={<AdminImport />} />
            {/* v1-hidden: <Route path="coaching"         element={<AdminCoaching />} /> */}
            <Route path="bookings"         element={<AdminBookings />} />
            <Route path="payments"         element={<AdminPayments />} />
            <Route path="tasks"            element={<AdminTasks />} />
            <Route path="readiness-rules"  element={<AdminReadinessRules />} />
            <Route path="invites"          element={<AdminInvites />} />
            <Route path="audit"            element={<AdminAudit />} />
            <Route path="error-logs"       element={<AdminErrorLogs />} />
            <Route path="profile"          element={<AdminProfile />} />
            {/* v1-hidden: <Route path="cg-colleges"       element={<AdminCGColleges />} /> */}
            {/* v1-hidden: <Route path="cg-entrance-exams" element={<AdminCGEntranceExams />} /> */}
            {/* v1-hidden: <Route path="cg-scholarships"   element={<AdminCGScholarships />} /> */}
            {/* v1-hidden: <Route path="cg-govt-exams"     element={<AdminCGGovtExams />} /> */}
            {/* v1-hidden: <Route path="cg-abroad"         element={<AdminCGAbroad />} /> */}
            {/* v1-hidden: <Route path="cg-branches"       element={<AdminCGBranches />} /> */}
            {/* v1-hidden: <Route path="cg-rank-data"      element={<AdminCGRankData />} /> */}
            {/* v1-hidden: <Route path="cg-content"        element={<AdminCGContent />} /> */}
            {/* v1-hidden: <Route path="cg-ai-prompts"     element={<AdminCGAIPrompts />} /> */}
            {/* v1-hidden: <Route path="mock-tests"        element={<AdminMockTests />} /> */}
            {/* v1-hidden: <Route path="exam-resources"    element={<AdminExamResources />} /> */}
            <Route path="analytics"         element={<AdminAnalytics />} />
            <Route path="courses"          element={<AdminCourses />} />
            <Route path="communities"       element={<AdminCommunities />} />
            <Route path="college-reviews"   element={<AdminCollegeReviews />} />
            <Route path="referrals"         element={<AdminReferrals />} />
            <Route path="coupons"           element={<AdminCoupons />} />
            <Route path="subscriptions"     element={<AdminSubscriptions />} />
            <Route path="market"            element={<AdminMarket />} />
            <Route path="score-rules"       element={<AdminScoreRules />} />
            <Route path="moderation"        element={<AdminModeration />} />
            <Route path="support"           element={<AdminSupport />} />
            <Route path="stages"            element={<AdminStages />} />
            <Route path="streaks"           element={<AdminStreaks />} />
            <Route path="readiness"         element={<AdminReadinessV21 />} />
            <Route path="leaderboard"       element={<AdminLeaderboard />} />
            <Route path="engagement"        element={<AdminEngagement />} />
            <Route path="wallet"            element={<AdminWallet />} />
            <Route path="community-safety"  element={<AdminCommunitySafety />} />
            <Route path="platform-v1"       element={<AdminPlatformV1 />} />
          </Route>

          {/* ── Super admin portal ───────────────────────────── */}
          {/* Landing — public, and visually distinct from the admin one so the
              two consoles are never confused for each other. */}
          <Route path="/skovo-platform-owner/home"            element={<Navigate to="/console" replace />} />
          <Route path="/skovo-platform-owner/login"           element={<SuperLogin />} />
          <Route path="/skovo-platform-owner/register"        element={<Navigate to="/skovo-platform-owner/login" replace />} />
          <Route path="/skovo-platform-owner/forgot-password" element={<Navigate to="/skovo-platform-owner/login" replace />} />
          <Route
            path="/skovo-platform-owner"
            element={<SuperRoute><SuperLayout /></SuperRoute>}
          >
            <Route index element={<SuperDashboard />} />
            <Route path="admins"      element={<SuperAdmins />} />
            {/* The owner's two screens: money and who may administer it. */}
            <Route path="business"         element={<SuperBusinessDashboard />} />
            <Route path="admin-approvals"  element={<SuperAdminApprovals />} />
            <Route path="users"       element={<SuperUsers />} />
            <Route path="achievers"   element={<SuperMentors />} />
            <Route path="cohorts"     element={<SuperCohorts />} />
            <Route path="courses"     element={<SuperCourses />} />
            <Route path="enrollments" element={<SuperEnrollments />} />
            <Route path="readiness"   element={<SuperReadiness />} />
            <Route path="v1-overview" element={<SuperV1Overview />} />
            <Route path="opportunities" element={<SuperOpportunities />} />
            <Route path="communities" element={<SuperCommunities />} />
            <Route path="audit"       element={<SuperAuditLog />} />
            <Route path="profile"     element={<SuperProfile />} />
          </Route>

          </>)}

          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}

export default App;
