import { QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createQueryClient } from '@/lib/query-client';
import { mockApi } from '@/test/mock-api';
import { ReceivingPage } from './receiving';

const staff = {
  id: '2',
  email: 'staff_b01@erp.local',
  name: 'Staff B01',
  role: 'STORE_EMPLOYEE',
  storeId: 'store-b01',
};

const order = {
  id: 'po1',
  number: 'PO-DEMO-001',
  status: 'APPROVED',
  supplierCode: 'SUP01',
  supplierName: 'SupplyOne Co Ltd',
  storeId: 'store-b01',
  storeCode: 'B01',
  storeName: 'Central Store',
  expectedReceiptDate: '2026-11-15',
  lines: [
    {
      id: 'line1',
      productId: 'p1',
      sku: 'SKU001',
      productName: 'Drinking water pack of 6',
      unit: 'pack',
      ordered: 20,
      received: 0,
      outstanding: 20,
    },
  ],
};

const page = (items: unknown[]) => ({
  items,
  page: 1,
  pageSize: 20,
  total: items.length,
  hasMore: false,
});

function renderReceiving() {
  const router = createMemoryRouter([{ path: '/', element: <ReceivingPage /> }], {
    initialEntries: ['/'],
  });
  render(
    <QueryClientProvider client={createQueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

describe('ReceivingPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('lists receivable orders with ordered and outstanding quantities', async () => {
    mockApi({ 'GET /auth/me': { user: staff }, 'GET /receiving/orders': page([order]) });

    renderReceiving();

    expect(await screen.findByText('PO-DEMO-001')).toBeInTheDocument();
    expect(screen.getByText(/SKU001 Drinking water pack of 6/)).toBeInTheDocument();
    // The outstanding quantity is shown so the employee knows how much is left.
    expect(screen.getByText(/คงเหลือ 20/)).toBeInTheDocument();
  });

  it('shows an empty state when nothing is receivable', async () => {
    mockApi({ 'GET /auth/me': { user: staff }, 'GET /receiving/orders': page([]) });

    renderReceiving();

    expect(await screen.findByText(/ยังไม่มีใบสั่งซื้อที่รอรับ/)).toBeInTheDocument();
  });

  it('confirms a receipt with an idempotency key and the entered quantity', async () => {
    const fetch = vi.fn(async (request: Request) => {
      const path = new URL(request.url).pathname.replace(/^\/api/, '');
      if (request.method === 'GET' && path === '/auth/me') return Response.json({ user: staff });
      if (request.method === 'GET' && path === '/receiving/orders')
        return Response.json(page([order]));
      if (request.method === 'POST' && path === '/goods-receipts') {
        return Response.json({
          id: 'gr1',
          number: 'GR-000001',
          purchaseOrderId: 'po1',
          purchaseOrderNumber: 'PO-DEMO-001',
          storeId: 'store-b01',
          storeCode: 'B01',
          storeName: 'Central Store',
          receivedById: '2',
          receivedByName: 'Staff B01',
          receivedAt: '2026-11-15T03:00:00.000Z',
          lines: [
            {
              id: 'grl1',
              purchaseOrderLineId: 'line1',
              productId: 'p1',
              sku: 'SKU001',
              productName: 'Drinking water pack of 6',
              unit: 'pack',
              quantity: 8,
            },
          ],
        });
      }
      return Response.json({ message: 'no mock' }, { status: 404 });
    });
    vi.stubGlobal('fetch', fetch);

    renderReceiving();
    await screen.findByText('PO-DEMO-001');

    fireEvent.change(screen.getByLabelText('รับ SKU001'), { target: { value: '8' } });
    fireEvent.click(screen.getByRole('button', { name: 'ยืนยันการรับสินค้า PO-DEMO-001' }));

    await waitFor(() => {
      const posted = fetch.mock.calls.find(([r]) => r.method === 'POST');
      expect(posted).toBeTruthy();
    });
    const posted = fetch.mock.calls.find(([r]) => r.method === 'POST')![0];
    const body = (await posted.json()) as {
      idempotencyKey: string;
      purchaseOrderId: string;
      lines: { purchaseOrderLineId: string; quantity: number }[];
    };
    expect(body.purchaseOrderId).toBe('po1');
    expect(body.lines).toContainEqual({ purchaseOrderLineId: 'line1', quantity: 8 });
    // A client-supplied idempotency key guards against a double-submit (GR-04).
    expect(body.idempotencyKey.length).toBeGreaterThanOrEqual(8);
  });
});
