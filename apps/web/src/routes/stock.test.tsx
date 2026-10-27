import { QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createQueryClient } from '@/lib/query-client';
import { mockApi } from '@/test/mock-api';
import { StockPage } from './stock';

const manager = {
  id: '1',
  email: 'manager01@erp.local',
  name: 'Manager 01',
  role: 'MANAGER',
  storeId: null,
};

function renderStock() {
  const router = createMemoryRouter([{ path: '/', element: <StockPage /> }], {
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

const level = (overrides: Record<string, unknown>) => ({
  productId: 'p1',
  sku: 'SKU001',
  productName: 'Drinking water pack of 6',
  unit: 'pack',
  storeId: 's1',
  storeCode: 'B01',
  storeName: 'Central Store',
  quantity: 10,
  reorderThreshold: 3,
  lowStock: false,
  ...overrides,
});

const opening = {
  id: 'm1',
  productId: 'p1',
  productSku: 'SKU001',
  productName: 'Drinking water pack of 6',
  storeId: 's1',
  storeCode: 'B01',
  quantityChange: 10,
  balanceBefore: 0,
  balanceAfter: 10,
  movementType: 'OPENING',
  sourceDocumentType: 'OPENING_BALANCE',
  sourceDocumentNumber: null,
  actorId: 'u1',
  actorName: 'Manager 01',
  createdAt: '2026-10-27T07:00:00.000Z',
};

const stores = page([
  { id: 's1', code: 'B01', name: 'Central Store' },
  { id: 's2', code: 'B02', name: 'Riverside Store' },
]);

const routes = (overrides: Record<string, unknown> = {}) => ({
  'GET /auth/me': { user: manager },
  'GET /stores': stores,
  'GET /stock': page([level({})]),
  'GET /stock/movements': page([opening]),
  ...overrides,
});

describe('StockPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows quantity, unit and threshold for each product in each store', async () => {
    mockApi(routes());

    renderStock();

    const row = (await screen.findByText('Drinking water pack of 6')).closest('li')!;
    expect(within(row).getByText('SKU001')).toBeInTheDocument();
    expect(within(row).getByText('B01')).toBeInTheDocument();
    expect(within(row).getByText('คงเหลือ 10 pack')).toBeInTheDocument();
    expect(within(row).getByText('จุดสั่งซื้อ 3')).toBeInTheDocument();
    expect(within(row).queryByText('สต็อกต่ำ')).not.toBeInTheDocument();
  });

  it('flags low stock only on the rows the API flags', async () => {
    mockApi(
      routes({
        'GET /stock': page([
          level({}),
          level({
            productId: 'p3',
            sku: 'SKU003',
            productName: 'Laundry detergent',
            unit: 'bag',
            quantity: 0,
            lowStock: true,
          }),
        ]),
      }),
    );

    renderStock();

    const low = (await screen.findByText('Laundry detergent')).closest('li')!;
    expect(within(low).getByText('สต็อกต่ำ')).toBeInTheDocument();
    expect(within(low).getByText('คงเหลือ 0 bag')).toBeInTheDocument();
    const fine = screen.getByText('Drinking water pack of 6').closest('li')!;
    expect(within(fine).queryByText('สต็อกต่ำ')).not.toBeInTheDocument();
  });

  it('says so when a product has no reorder threshold in a store', async () => {
    mockApi(routes({ 'GET /stock': page([level({ reorderThreshold: null })]) }));

    renderStock();

    expect(await screen.findByText('ไม่ได้ตั้งจุดสั่งซื้อ')).toBeInTheDocument();
  });

  it('asks the API for the typed SKU or name and the chosen store', async () => {
    const fetch = mockApi(routes());

    renderStock();
    await screen.findByText('Drinking water pack of 6');
    fireEvent.change(screen.getByLabelText('ค้นหา SKU หรือชื่อ'), { target: { value: 'SKU003' } });
    await screen.findByRole('option', { name: 'B01 Central Store' });
    fireEvent.change(screen.getByLabelText('สาขา'), { target: { value: 's1' } });

    await waitFor(() => {
      const urls = fetch.mock.calls
        .map(([request]) => new URL(request.url))
        .filter((url) => url.pathname === '/api/stock');
      expect(
        urls.some(
          (url) =>
            url.searchParams.get('search') === 'SKU003' && url.searchParams.get('storeId') === 's1',
        ),
      ).toBe(true);
    });
  });

  it('shows an empty state when nothing matches', async () => {
    mockApi(routes({ 'GET /stock': page([]) }));

    renderStock();

    expect(await screen.findByText('ไม่พบสต็อกที่ตรงกับการค้นหา')).toBeInTheDocument();
  });

  it('shows an alert when the stock cannot be loaded', async () => {
    mockApi(
      routes({
        'GET /stock': Response.json(
          { code: 'INTERNAL_SERVER_ERROR', status: 500, message: 'x' },
          { status: 500 },
        ),
      }),
    );

    renderStock();

    // The query client retries a failed read once, after a one second delay.
    const alert = await screen.findByRole('alert', {}, { timeout: 4000 });
    expect(alert).toHaveTextContent('โหลดสต็อกไม่สำเร็จ');
  });

  it('lists the movement history read-only, with before and after balances', async () => {
    mockApi(routes());

    renderStock();

    const heading = await screen.findByText('ประวัติการเคลื่อนไหวสต็อก');
    const history = heading.closest('[data-slot="card"]') as HTMLElement;
    const row = (await within(history).findByText('ยอดยกมา')).closest('li')!;
    expect(within(row).getByText('SKU001')).toBeInTheDocument();
    expect(within(row).getByText('+10')).toBeInTheDocument();
    expect(within(row).getByText('ก่อน 0 หลัง 10')).toBeInTheDocument();
    expect(within(row).getByText('Manager 01')).toBeInTheDocument();
    // Confirmed movements cannot be edited or deleted: the row offers no button at all.
    expect(within(history).queryByRole('button')).not.toBeInTheDocument();
    expect(within(history).getByText(/แก้ไขหรือลบไม่ได้/)).toBeInTheDocument();
  });
});
