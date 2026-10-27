import { QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createQueryClient } from '@/lib/query-client';
import { mockApi } from '@/test/mock-api';
import { SuppliersPage } from './suppliers';

const admin = { id: '1', email: 'admin@erp.local', name: 'Admin', role: 'ADMIN', storeId: null };
const staff = {
  id: '2',
  email: 'staff_b01@erp.local',
  name: 'Staff',
  role: 'STORE_EMPLOYEE',
  storeId: 'B01',
};

function renderSuppliers() {
  const router = createMemoryRouter([{ path: '/', element: <SuppliersPage /> }], {
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

const sup = {
  id: 'sup1',
  code: 'SUP01',
  name: 'SupplyOne Co Ltd',
  contactName: null,
  contactPhone: null,
  contactEmail: null,
};

describe('SuppliersPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('lists suppliers from the API', async () => {
    mockApi({ 'GET /auth/me': { user: admin }, 'GET /suppliers': page([sup]) });

    renderSuppliers();

    expect(await screen.findByText('SupplyOne Co Ltd')).toBeInTheDocument();
    expect(screen.getByText('SUP01')).toBeInTheDocument();
  });

  it('shows an empty state when there are no suppliers', async () => {
    mockApi({ 'GET /auth/me': { user: admin }, 'GET /suppliers': page([]) });

    renderSuppliers();

    expect(await screen.findByText(/ยังไม่มีผู้จัดจำหน่าย/)).toBeInTheDocument();
  });

  it('creates a supplier, posts the entered data, and shows the new row', async () => {
    const created = { ...sup, id: 'sup2', code: 'SUP02', name: 'New Supplier' };
    let listCalls = 0;
    const fetch = vi.fn(async (request: Request) => {
      const url = new URL(request.url);
      const path = url.pathname.replace(/^\/api/, '');
      if (request.method === 'GET' && path === '/auth/me') return Response.json({ user: admin });
      if (request.method === 'GET' && path === '/suppliers') {
        listCalls += 1;
        return Response.json(listCalls === 1 ? page([sup]) : page([created, sup]));
      }
      if (request.method === 'POST' && path === '/suppliers') return Response.json(created);
      return Response.json({ message: 'no mock' }, { status: 404 });
    });
    vi.stubGlobal('fetch', fetch);

    renderSuppliers();
    await screen.findByText('SupplyOne Co Ltd');

    fireEvent.change(screen.getByLabelText('รหัส'), { target: { value: 'SUP02' } });
    fireEvent.change(screen.getByLabelText('ชื่อ'), { target: { value: 'New Supplier' } });
    fireEvent.click(screen.getByRole('button', { name: 'เพิ่มผู้จัดจำหน่าย' }));

    // The POST carries the entered data...
    await waitFor(() => {
      const posted = fetch.mock.calls.find(([r]) => r.method === 'POST');
      expect(posted).toBeTruthy();
    });
    const posted = fetch.mock.calls.find(([r]) => r.method === 'POST')![0];
    await expect(posted.json()).resolves.toMatchObject({ code: 'SUP02', name: 'New Supplier' });

    // ...and the refreshed list shows the new supplier on screen.
    expect(await screen.findByText('New Supplier')).toBeInTheDocument();
  });

  it('edits a supplier’s contact details and sends a PATCH', async () => {
    const fetch = vi.fn(async (request: Request) => {
      const path = new URL(request.url).pathname.replace(/^\/api/, '');
      if (request.method === 'GET' && path === '/auth/me') return Response.json({ user: admin });
      if (request.method === 'GET' && path === '/suppliers') return Response.json(page([sup]));
      if (request.method === 'PATCH' && path === '/suppliers/sup1') {
        return Response.json({ ...sup, contactPhone: '02-999-0000' });
      }
      return Response.json({ message: 'no mock' }, { status: 404 });
    });
    vi.stubGlobal('fetch', fetch);

    renderSuppliers();
    fireEvent.click(await screen.findByRole('button', { name: 'แก้ไข SUP01' }));

    fireEvent.change(await screen.findByLabelText('โทรศัพท์ (แก้ไข)'), {
      target: { value: '02-999-0000' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'บันทึกการแก้ไข' }));

    await waitFor(() => {
      const patched = fetch.mock.calls.find(([r]) => r.method === 'PATCH');
      expect(patched).toBeTruthy();
    });
    const patched = fetch.mock.calls.find(([r]) => r.method === 'PATCH')![0];
    await expect(patched.json()).resolves.toMatchObject({ contactPhone: '02-999-0000' });
  });

  it('hides the add/edit controls from a non-admin', async () => {
    mockApi({ 'GET /auth/me': { user: staff }, 'GET /suppliers': page([sup]) });

    renderSuppliers();

    // The list is still visible to any signed-in user...
    expect(await screen.findByText('SupplyOne Co Ltd')).toBeInTheDocument();
    // ...but the admin-only create form and edit buttons are not rendered.
    expect(screen.queryByRole('button', { name: 'เพิ่มผู้จัดจำหน่าย' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'แก้ไข SUP01' })).not.toBeInTheDocument();
  });
});
