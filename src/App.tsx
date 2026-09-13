import { Suspense, lazy } from 'react';
import { Route, Routes } from 'react-router-dom';
import Layout from './components/Layout';
import { KnightMark } from './components/Icons';
import Home from './pages/Home';
import Play from './pages/Play';

const Puzzles = lazy(() => import('./pages/Puzzles'));
const Analysis = lazy(() => import('./pages/Analysis'));
const Profile = lazy(() => import('./pages/Profile'));
const Review = lazy(() => import('./pages/Review'));

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="/play" element={<Play />} />
        <Route
          path="/analysis"
          element={
            <Suspense fallback={<PageLoading label="Loading analysis board…" />}>
              <Analysis />
            </Suspense>
          }
        />
        <Route
          path="/puzzles"
          element={
            <Suspense fallback={<PageLoading label="Loading puzzles…" />}>
              <Puzzles />
            </Suspense>
          }
        />
        <Route
          path="/profile"
          element={
            <Suspense fallback={<PageLoading label="Loading profile…" />}>
              <Profile />
            </Suspense>
          }
        />
        <Route
          path="/review/:id"
          element={
            <Suspense fallback={<PageLoading label="Loading game…" />}>
              <Review />
            </Suspense>
          }
        />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}

function PageLoading({ label }: { label: string }) {
  return (
    <div className="page container" aria-busy="true">
      <div className="empty-state">
        <div className="skeleton" style={{ width: 180, height: 20, margin: '0 auto 1rem' }} />
        <p>{label}</p>
      </div>
    </div>
  );
}

function NotFound() {
  return (
    <div className="page container">
      <div className="empty-state">
        <div className="glyph">
          <KnightMark />
        </div>
        <h1 style={{ fontFamily: 'var(--serif)', fontSize: '2rem' }}>Nothing here</h1>
        <p>This page doesn’t exist — perhaps the knight took a wrong turn.</p>
        <a className="btn btn-primary" href="#/play">
          Back to the board
        </a>
      </div>
    </div>
  );
}
