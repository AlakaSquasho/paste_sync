// client/src/components/AuthGuard.tsx
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api';

interface AuthGuardProps {
  children: React.ReactNode;
}

export default function AuthGuard({ children }: AuthGuardProps) {
  const navigate = useNavigate();
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const checkAuth = async () => {
      const token = localStorage.getItem('token');
      if (!token) {
        navigate('/login');
        return;
      }

      try {
        // Authoritative check: rejects tokens issued before accounts existed and
        // accounts that are no longer configured, and refreshes the displayed name.
        const { data } = await api.get<{ username: string }>('/auth/me');
        localStorage.setItem('username', data.username);
        setIsAuthenticated(true);
      } catch {
        // The response interceptor clears stored credentials and redirects on 401/403.
        navigate('/login');
      } finally {
        setIsLoading(false);
      }
    };

    void checkAuth();
  }, [navigate]);

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-sand dark:bg-night">
        <div className="h-12 w-12 animate-spin rounded-full border-2 border-ink/10 border-t-accent dark:border-white/10"></div>
      </div>
    );
  }

  return isAuthenticated ? <>{children}</> : null;
}
