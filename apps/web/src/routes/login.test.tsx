import { QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createQueryClient } from '@/lib/query-client';
import { mockApi, unauthorized } from '@/test/mock-api';
import { LoginPage } from './login';

const admin = {
  id: '1',
  email: 'admin@erp.local',
  name: 'Admin User',
  role: 'ADMIN',
  storeId: null,
};

function renderLogin(url = '/login') {
  const router = createMemoryRouter(
    [
      { path: '/login', element: <LoginPage /> },
      { path: '/', element: <p>Home page</p> },
      { path: '/orders', element: <p>Orders page</p> },
    ],
    { initialEntries: [url] },
  );
  render(
    <QueryClientProvider client={createQueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

async function signIn(email: string, password: string) {
  fireEvent.change(await screen.findByLabelText('Email'), { target: { value: email } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: password } });
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
}

describe('LoginPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('signs in and goes to the redirect target', async () => {
    const fetch = mockApi({ 'GET /auth/me': { user: null }, 'POST /auth/login': admin });

    renderLogin('/login?redirect=%2Forders');
    await signIn('admin@erp.local', 'password');

    expect(await screen.findByText('Orders page')).toBeInTheDocument();
    const login = fetch.mock.calls.find(([request]) => request.method === 'POST')![0];
    await expect(login.json()).resolves.toEqual({ email: 'admin@erp.local', password: 'password' });
  });

  it('shows an error for wrong credentials', async () => {
    mockApi({
      'GET /auth/me': { user: null },
      'POST /auth/login': unauthorized('Invalid email or password'),
    });

    renderLogin();
    await signIn('admin@erp.local', 'wrong');

    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password.');
  });

  it('fills in a demo account', async () => {
    mockApi({ 'GET /auth/me': { user: null } });

    renderLogin();
    fireEvent.click(await screen.findByText('staff_b01@erp.local'));

    expect(screen.getByLabelText('Email')).toHaveValue('staff_b01@erp.local');
    expect(screen.getByLabelText('Password')).toHaveValue('password');
  });

  it('ignores a redirect to another site', async () => {
    mockApi({ 'GET /auth/me': { user: admin } });

    renderLogin('/login?redirect=%2F%2Fevil.example');

    expect(await screen.findByText('Home page')).toBeInTheDocument();
  });
});
