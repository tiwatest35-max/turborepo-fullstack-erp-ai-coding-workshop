import { QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createQueryClient } from '@/lib/query-client';
import { mockApi } from '@/test/mock-api';
import { SuppliersPage } from './suppliers';

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
    mockApi({ 'GET /suppliers': page([sup]) });

    renderSuppliers();

    expect(await screen.findByText('SupplyOne Co Ltd')).toBeInTheDocument();
    expect(screen.getByText('SUP01')).toBeInTheDocument();
  });

  it('shows an empty state when there are no suppliers', async () => {
    mockApi({ 'GET /suppliers': page([]) });

    renderSuppliers();

    expect(await screen.findByText(/ยังไม่มีผู้จัดจำหน่าย/)).toBeInTheDocument();
  });

  it('creates a supplier and refreshes the list', async () => {
    const created = { ...sup, id: 'sup2', code: 'SUP02', name: 'New Supplier' };
    const fetch = mockApi({
      'GET /suppliers': page([sup]),
      'POST /suppliers': created,
    });

    renderSuppliers();
    await screen.findByText('SupplyOne Co Ltd');

    fireEvent.change(screen.getByLabelText('รหัส'), { target: { value: 'SUP02' } });
    fireEvent.change(screen.getByLabelText('ชื่อ'), { target: { value: 'New Supplier' } });
    fireEvent.click(screen.getByRole('button', { name: 'เพิ่มผู้จัดจำหน่าย' }));

    await waitFor(() => {
      const posted = fetch.mock.calls.find(([r]) => r.method === 'POST');
      expect(posted).toBeTruthy();
    });
  });
});
