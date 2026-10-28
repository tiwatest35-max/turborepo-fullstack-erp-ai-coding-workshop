import { QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createQueryClient } from '@/lib/query-client';
import { mockApi } from '@/test/mock-api';
import { MovementReportsPage } from './movement-reports';

const manager = {
  id: '1',
  email: 'manager01@erp.local',
  name: 'Manager',
  role: 'MANAGER',
  storeId: null,
};

const movement = {
  id: 'm1',
  productId: 'p1',
  productSku: 'SKU001',
  productName: 'Drinking water pack of 6',
  storeId: 's1',
  storeCode: 'B01',
  quantityChange: -2,
  balanceBefore: 10,
  balanceAfter: 8,
  movementType: 'SALE',
  sourceDocumentType: 'SALE',
  sourceDocumentNumber: 'SL-000001',
  actorId: 'u1',
  actorName: 'Staff B01',
  createdAt: '2026-10-11T05:00:00.000Z',
};

const page = (items: unknown[]) => ({
  items,
  page: 1,
  pageSize: 20,
  total: items.length,
  hasMore: false,
});

function renderPage() {
  const router = createMemoryRouter([{ path: '/', element: <MovementReportsPage /> }], {
    initialEntries: ['/'],
  });
  render(
    <QueryClientProvider client={createQueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

describe('MovementReportsPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('lists movements with their source document', async () => {
    mockApi({
      'GET /auth/me': { user: manager },
      'GET /stores': page([]),
      'GET /products': page([]),
      'GET /reports/movements': page([movement]),
    });

    renderPage();

    expect(await screen.findByText(/SKU001/)).toBeInTheDocument();
    // The source document is shown so the reader can open it.
    expect(screen.getByText(/SL-000001/)).toBeInTheDocument();
  });

  it('shows an empty state when nothing matches', async () => {
    mockApi({
      'GET /auth/me': { user: manager },
      'GET /stores': page([]),
      'GET /products': page([]),
      'GET /reports/movements': page([]),
    });

    renderPage();

    expect(await screen.findByText(/ไม่พบรายการเคลื่อนไหว/)).toBeInTheDocument();
  });

  it('sends the chosen movement-type filter to the API', async () => {
    const fetch = mockApi({
      'GET /auth/me': { user: manager },
      'GET /stores': page([]),
      'GET /products': page([]),
      'GET /reports/movements': page([movement]),
    });

    renderPage();
    await screen.findByText(/SKU001/);

    fireEvent.change(screen.getByLabelText('ประเภท'), { target: { value: 'SALE' } });

    await waitFor(() => {
      const called = fetch.mock.calls.some(([request]) => {
        const url = new URL(request.url);
        return (
          url.pathname.endsWith('/reports/movements') &&
          url.searchParams.get('movementType') === 'SALE'
        );
      });
      expect(called).toBe(true);
    });
  });
});
