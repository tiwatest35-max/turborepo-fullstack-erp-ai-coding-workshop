import { createBrowserRouter } from 'react-router';
import { RequireAuth } from '@/components/require-auth';
import { HomePage } from '@/routes/home';
import { LoginPage } from '@/routes/login';
import { RootLayout } from '@/routes/root-layout';
import { ProductsPage } from '@/routes/products';
import { PurchaseOrdersPage } from '@/routes/purchase-orders';
import { ReceivingPage } from '@/routes/receiving';
import { StockPage } from '@/routes/stock';
import { StockReportsPage } from '@/routes/stock-reports';
import { StoresPage } from '@/routes/stores';
import { SuppliersPage } from '@/routes/suppliers';

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    // Everything below requires a signed-in user.
    element: <RequireAuth />,
    children: [
      {
        path: '/',
        element: <RootLayout />,
        children: [
          { index: true, element: <HomePage /> },
          { path: 'products', element: <ProductsPage /> },
          { path: 'purchase-orders', element: <PurchaseOrdersPage /> },
          { path: 'receiving', element: <ReceivingPage /> },
          { path: 'reports/stock', element: <StockReportsPage /> },
          { path: 'stock', element: <StockPage /> },
          { path: 'stores', element: <StoresPage /> },
          { path: 'suppliers', element: <SuppliersPage /> },
        ],
      },
    ],
  },
]);
