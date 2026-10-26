import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HealthStatus } from '@/components/health-status';
import { createQueryClient } from '@/lib/query-client';
import { mockApi, unauthorized } from '@/test/mock-api';
import { RequireAuth } from './require-auth';

const staff = {
  id: '2',
  email: 'staff_b01@erp.local',
  name: 'Staff B01',
  role: 'STORE_EMPLOYEE',
  storeId: 'B01',
};

function LoginStub() {
  const location = useLocation();
  return <p>Login page {location.search}</p>;
}

function renderProtected(page: React.ReactElement, url = '/orders') {
  const router = createMemoryRouter(
    [
      { path: '/login', element: <LoginStub /> },
      { element: <RequireAuth />, children: [{ path: '/orders', element: page }] },
    ],
    { initialEntries: [url] },
  );
  render(
    <QueryClientProvider client={createQueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

describe('RequireAuth', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the page for a signed-in user', async () => {
    mockApi({ 'GET /auth/me': { user: staff } });

    renderProtected(<p>Orders page</p>);

    expect(await screen.findByText('Orders page')).toBeInTheDocument();
  });

  it('redirects to /login and remembers where the user was going', async () => {
    mockApi({ 'GET /auth/me': { user: null } });

    renderProtected(<p>Orders page</p>, '/orders?status=open');

    expect(
      await screen.findByText('Login page ?redirect=%2Forders%3Fstatus%3Dopen'),
    ).toBeInTheDocument();
  });

  it('redirects to /login when any API call answers 401', async () => {
    mockApi({ 'GET /auth/me': { user: staff }, 'GET /health': unauthorized() });

    renderProtected(<HealthStatus />);

    expect(await screen.findByText(/^Login page/)).toBeInTheDocument();
  });
});
