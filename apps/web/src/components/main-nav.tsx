import { NavLink } from 'react-router';
import { cn } from '@/lib/utils';

/** The pages in the app, in the order they appear in the top navigation. */
const links = [
  { to: '/products', label: 'สินค้า' },
  { to: '/stores', label: 'สาขา' },
  { to: '/suppliers', label: 'ผู้จัดจำหน่าย' },
  { to: '/purchase-orders', label: 'ใบสั่งซื้อ' },
  { to: '/receiving', label: 'รับสินค้า' },
  { to: '/stock', label: 'สต็อก' },
  { to: '/reports/sales', label: 'รายงานยอดขาย' },
  { to: '/reports/stock', label: 'รายงานสต็อก' },
  { to: '/reports/movements', label: 'รายงานการเคลื่อนไหว' },
] as const;

/** The top navigation. Every page is reachable from here; the current page is highlighted. */
export function MainNav() {
  return (
    <nav aria-label="เมนูหลัก" className="border-b">
      <ul className="mx-auto flex max-w-5xl flex-wrap gap-x-4 gap-y-1 px-6 py-2 text-sm">
        {links.map((link) => (
          <li key={link.to}>
            <NavLink
              to={link.to}
              className={({ isActive }) =>
                cn(
                  'rounded px-2 py-1 text-muted-foreground transition-colors hover:text-foreground',
                  isActive && 'bg-muted font-medium text-foreground',
                )
              }
            >
              {link.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
