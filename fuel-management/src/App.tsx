import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from './lib/auth';
import { supabaseConfigured } from './lib/supabase';
import { AppLayout, RequireAuth } from './components/AppLayout';
import { Alert, ToastProvider } from './components/ui';
import { ForgotPasswordPage, LoginPage, PendingPage, RegisterPage, ResetPasswordPage } from './pages/auth/AuthPages';
import DashboardPage from './pages/Dashboard';
import PadsWellsPage from './pages/PadsWells';
import UsersPage from './pages/Users';
import OrdersPage from './pages/Orders';
import HistoryPage from './pages/History';
import StagesPage from './pages/Stages';
import DeliveriesPage from './pages/Deliveries';
import InventoryPage from './pages/Inventory';
import ReportPage from './pages/Report';

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: true, staleTime: 30_000 } } });

function MissingConfig() {
  return (
    <div className="grid min-h-screen place-items-center bg-slate-50 p-6">
      <div className="max-w-lg">
        <Alert tone="warning" title="Falta configurar la conexión con Supabase">
          Copie <code>.env.example</code> a <code>.env.local</code> y complete <code>VITE_SUPABASE_URL</code> y <code>VITE_SUPABASE_ANON_KEY</code> con los datos del
          proyecto (Supabase → Project Settings → API). Luego reinicie la aplicación.
        </Alert>
      </div>
    </div>
  );
}

export default function App() {
  if (!supabaseConfigured) return <MissingConfig />;
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <AuthProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/ingresar" element={<LoginPage />} />
              <Route path="/registro" element={<RegisterPage />} />
              <Route path="/recuperar" element={<ForgotPasswordPage />} />
              <Route path="/restablecer" element={<ResetPasswordPage />} />
              <Route path="/pendiente" element={<PendingPage />} />
              <Route element={<RequireAuth />}>
                <Route element={<AppLayout />}>
                  <Route index element={<DashboardPage />} />
                  <Route path="pads" element={<PadsWellsPage />} />
                  <Route path="pedidos" element={<OrdersPage />} />
                  <Route path="historial" element={<HistoryPage />} />
                  <Route path="etapas" element={<StagesPage />} />
                  <Route path="entregas" element={<DeliveriesPage />} />
                  <Route path="inventario" element={<InventoryPage />} />
                  <Route path="reporte" element={<ReportPage />} />
                  <Route element={<RequireAuth roles={['administrador']} />}>
                    <Route path="usuarios" element={<UsersPage />} />
                  </Route>
                </Route>
              </Route>
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </BrowserRouter>
        </AuthProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
}
