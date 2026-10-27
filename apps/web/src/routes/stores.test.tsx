import { QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createQueryClient } from '@/lib/query-client';
import { mockApi } from '@/test/mock-api';
import { StoresPage } from './stores';

const admin = { id: '1', email: 'admin@erp.local', name: 'Admin', role: 'ADMIN', storeId: null };
const staff = {
  id: '2',
  email: 'staff_b01@erp.local',
  name: 'Staff',
  role: 'STORE_EMPLOYEE',
  storeId: 'st1',
};

function renderStores() {
  const router = createMemoryRouter([{ path: '/', element: <StoresPage /> }], {
    initialEntries: ['/'],
  });
  render(
    <QueryClientProvider client={createQueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

const page = (items: unknown[]) => ({
  items,
  page: 1,
  pageSize: 20,
  total: items.length,
  hasMore: false,
});

const central = { id: 'st1', code: 'B01', name: 'Central Store' };

describe('StoresPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('lists stores from the API', async () => {
    mockApi({ 'GET /auth/me': { user: admin }, 'GET /stores': page([central]) });

    renderStores();

    expect(await screen.findByText('Central Store')).toBeInTheDocument();
    expect(screen.getByText('B01')).toBeInTheDocument();
  });

  it('shows an empty state when there are no stores', async () => {
    mockApi({ 'GET /auth/me': { user: admin }, 'GET /stores': page([]) });

    renderStores();

    expect(await screen.findByText(/ยังไม่มีสาขา/)).toBeInTheDocument();
  });

  it('creates a store, posts the entered data, and shows the new row', async () => {
    const created = { id: 'st2', code: 'B03', name: 'Harbour Store' };
    let listCalls = 0;
    const fetch = vi.fn(async (request: Request) => {
      const path = new URL(request.url).pathname.replace(/^\/api/, '');
      if (request.method === 'GET' && path === '/auth/me') return Response.json({ user: admin });
      if (request.method === 'GET' && path === '/stores') {
        listCalls += 1;
        return Response.json(listCalls === 1 ? page([central]) : page([created, central]));
      }
      if (request.method === 'POST' && path === '/stores') return Response.json(created);
      return Response.json({ message: 'no mock' }, { status: 404 });
    });
    vi.stubGlobal('fetch', fetch);

    renderStores();
    await screen.findByText('Central Store');

    fireEvent.change(screen.getByLabelText('รหัส'), { target: { value: 'B03' } });
    fireEvent.change(screen.getByLabelText('ชื่อ'), { target: { value: 'Harbour Store' } });
    fireEvent.click(screen.getByRole('button', { name: 'เพิ่มสาขา' }));

    await waitFor(() => {
      expect(fetch.mock.calls.find(([r]) => r.method === 'POST')).toBeTruthy();
    });
    const posted = fetch.mock.calls.find(([r]) => r.method === 'POST')![0];
    await expect(posted.json()).resolves.toEqual({ code: 'B03', name: 'Harbour Store' });

    expect(await screen.findByText('Harbour Store')).toBeInTheDocument();
  });

  it('shows an alert when the code is already taken', async () => {
    const fetch = vi.fn(async (request: Request) => {
      const path = new URL(request.url).pathname.replace(/^\/api/, '');
      if (request.method === 'GET' && path === '/auth/me') return Response.json({ user: admin });
      if (request.method === 'GET' && path === '/stores') return Response.json(page([central]));
      if (request.method === 'POST' && path === '/stores') {
        return Response.json(
          {
            defined: true,
            code: 'CONFLICT',
            status: 409,
            message: 'conflict',
            data: {
              code: 'STORE_CODE_TAKEN',
              messageTh: 'รหัสสาขานี้ถูกใช้แล้ว',
              action: 'correct_input',
            },
          },
          { status: 409 },
        );
      }
      return Response.json({ message: 'no mock' }, { status: 404 });
    });
    vi.stubGlobal('fetch', fetch);

    renderStores();
    await screen.findByText('Central Store');

    fireEvent.change(screen.getByLabelText('รหัส'), { target: { value: 'B01' } });
    fireEvent.change(screen.getByLabelText('ชื่อ'), { target: { value: 'Dup' } });
    fireEvent.click(screen.getByRole('button', { name: 'เพิ่มสาขา' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('เพิ่มสาขาไม่สำเร็จ');
  });

  it('edits a store’s name and sends a PATCH', async () => {
    const fetch = vi.fn(async (request: Request) => {
      const path = new URL(request.url).pathname.replace(/^\/api/, '');
      if (request.method === 'GET' && path === '/auth/me') return Response.json({ user: admin });
      if (request.method === 'GET' && path === '/stores') return Response.json(page([central]));
      if (request.method === 'PATCH' && path === '/stores/st1') {
        return Response.json({ ...central, name: 'Central Plaza' });
      }
      return Response.json({ message: 'no mock' }, { status: 404 });
    });
    vi.stubGlobal('fetch', fetch);

    renderStores();
    fireEvent.click(await screen.findByRole('button', { name: 'แก้ไข B01' }));

    fireEvent.change(await screen.findByLabelText('ชื่อ (แก้ไข)'), {
      target: { value: 'Central Plaza' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'บันทึกการแก้ไข' }));

    await waitFor(() => {
      expect(fetch.mock.calls.find(([r]) => r.method === 'PATCH')).toBeTruthy();
    });
    const patched = fetch.mock.calls.find(([r]) => r.method === 'PATCH')![0];
    await expect(patched.json()).resolves.toEqual({ name: 'Central Plaza' });
  });

  it('hides the add/edit controls from a non-admin', async () => {
    mockApi({ 'GET /auth/me': { user: staff }, 'GET /stores': page([central]) });

    renderStores();

    expect(await screen.findByText('Central Store')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'เพิ่มสาขา' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'แก้ไข B01' })).not.toBeInTheDocument();
  });
});
