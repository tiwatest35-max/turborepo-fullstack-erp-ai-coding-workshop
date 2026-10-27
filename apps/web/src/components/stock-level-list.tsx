import type { StockLevel } from '@erp/contracts';
import { Badge } from '@/components/ui/badge';

/** One row per product per store: quantity, reorder threshold and the low-stock flag. */
export function StockLevelList({ levels }: { levels: StockLevel[] }) {
  return (
    <ul className="divide-y">
      {levels.map((level) => (
        <li
          key={`${level.productId}:${level.storeId}`}
          className="flex items-center justify-between py-2"
        >
          <span className="flex items-center gap-3">
            <span className="font-medium">{level.productName}</span>
            <span className="text-muted-foreground">{level.sku}</span>
            <span className="text-muted-foreground">{level.storeCode}</span>
          </span>
          <span className="flex items-center gap-3">
            <span>{`คงเหลือ ${level.quantity} ${level.unit}`}</span>
            <span className="text-muted-foreground">
              {level.reorderThreshold === null
                ? 'ไม่ได้ตั้งจุดสั่งซื้อ'
                : `จุดสั่งซื้อ ${level.reorderThreshold}`}
            </span>
            {level.lowStock && <Badge variant="destructive">สต็อกต่ำ</Badge>}
          </span>
        </li>
      ))}
    </ul>
  );
}
