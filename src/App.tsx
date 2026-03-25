import { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { BoltIcon } from '@/components/ui/Icons';

const LandingPage = lazy(() => import('@/pages/LandingPage'));
const DashboardPage = lazy(() => import('@/pages/DashboardPage'));

function FullScreenLoader() {
  return (
    <div className="min-h-screen bg-storm-950 flex flex-col items-center justify-center gap-4">
      <BoltIcon className="w-10 h-10 text-bolt-500 animate-pulse" />
      <p className="text-xs font-mono text-storm-500 uppercase tracking-widest">
        Loading…
      </p>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<FullScreenLoader />}>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
