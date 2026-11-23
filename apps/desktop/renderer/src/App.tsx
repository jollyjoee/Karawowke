import { useEffect, useState } from 'react';
import HomePage from '@/app/page';
import TvPlayerPage from '@/app/player/page';
import MobileRemotePage from '@/app/remote/page';

export function App() {
  const [pathname, setPathname] = useState<string>(() => window.location.pathname || '/player');

  useEffect(() => {
    const syncPath = () => setPathname(window.location.pathname || '/');
    window.addEventListener('popstate', syncPath);
    return () => window.removeEventListener('popstate', syncPath);
  }, []);

  if (pathname.startsWith('/remote')) {
    return <MobileRemotePage />;
  }
  if (pathname.startsWith('/player')) {
    return <TvPlayerPage />;
  }
  return <HomePage />;
}
