import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ORPCError } from '@orpc/client';
import { type FormEvent, useState } from 'react';
import type { Product } from '@erp/contracts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useCurrentUser } from '@/lib/auth';
import { orpc } from '@/lib/orpc';

type StatusFilter = 'all' | 'active' | 'inactive';

/** The server's Thai message when it sent one; otherwise a message for rejected input. */
function errorMessage(error: unknown): string {
  if (error instanceof ORPCError) {
    const data = error.data as { messageTh?: unknown } | undefined;
    if (typeof data?.messageTh === 'string') return data.messageTh;
    if (error.code === 'BAD_REQUEST') {
      return 'ข้อมูลไม่ถูกต้อง ราคาขายและจุดสั่งซื้อต้องไม่ติดลบ และจุดสั่งซื้อต้องเป็นจำนวนเต็ม';
    }
  }
  return 'บันทึกสินค้าไม่สำเร็จ โปรดลองอีกครั้ง';
}

/** Admin screen: search products, add or edit one, and deactivate or reactivate it. */
export function ProductsPage() {
  const queryClient = useQueryClient();
  const user = useCurrentUser();
  const isAdmin = user?.role === 'ADMIN';

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const products = useQuery(
    orpc.products.list.queryOptions({
      input: { page: 1, pageSize: 20, status, ...(search.trim() && { search: search.trim() }) },
    }),
  );
  const stores = useQuery(orpc.stores.list.queryOptions({ input: { page: 1, pageSize: 100 } }));

  const refreshList = () =>
    void queryClient.invalidateQueries({ queryKey: orpc.products.list.key() });

  // The product being edited, or null while adding a new one.
  const [editing, setEditing] = useState<Product | null>(null);
  const [sku, setSku] = useState('');
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [unit, setUnit] = useState('');
  const [sellingPrice, setSellingPrice] = useState('');
  // Reorder threshold text per store id; an empty box means no threshold for that store.
  const [thresholds, setThresholds] = useState<Record<string, string>>({});

  const resetForm = () => {
    setEditing(null);
    setSku('');
    setName('');
    setCategory('');
    setUnit('');
    setSellingPrice('');
    setThresholds({});
  };

  const create = useMutation(
    orpc.products.create.mutationOptions({
      onSuccess: () => {
        resetForm();
        refreshList();
      },
    }),
  );
  const update = useMutation(
    orpc.products.update.mutationOptions({
      onSuccess: () => {
        resetForm();
        refreshList();
      },
    }),
  );
  const setActive = useMutation(orpc.products.update.mutationOptions({ onSuccess: refreshList }));

  const startEditing = (product: Product) => {
    create.reset();
    update.reset();
    setEditing(product);
    setSku(product.sku);
    setName(product.name);
    setCategory(product.category);
    setUnit(product.unit);
    setSellingPrice(String(product.sellingPrice));
    setThresholds(
      Object.fromEntries(product.reorderThresholds.map((t) => [t.storeId, String(t.threshold)])),
    );
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const fields = {
      sku,
      name,
      category,
      unit,
      sellingPrice: Number(sellingPrice),
      reorderThresholds: Object.entries(thresholds)
        .filter(([, value]) => value.trim() !== '')
        .map(([storeId, value]) => ({ storeId, threshold: Number(value) })),
    };
    if (editing) update.mutate({ id: editing.id, ...fields });
    else create.mutate(fields);
  };

  const saveError = editing ? update.error : create.error;
  const saving = create.isPending || update.isPending;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">สินค้า</h1>
        <p className="text-muted-foreground">
          จัดการ SKU ชื่อ หมวดหมู่ หน่วย ราคาขาย สถานะ และจุดสั่งซื้อของแต่ละสาขา
        </p>
      </div>

      {isAdmin && (
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle>{editing ? `แก้ไข ${editing.sku}` : 'เพิ่มสินค้า'}</CardTitle>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={submit}>
              <div className="space-y-2">
                <Label htmlFor="sku">SKU</Label>
                <Input id="sku" required value={sku} onChange={(e) => setSku(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="name">ชื่อ</Label>
                <Input id="name" required value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="category">หมวดหมู่</Label>
                <Input
                  id="category"
                  required
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="unit">หน่วย</Label>
                <Input id="unit" required value={unit} onChange={(e) => setUnit(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="sellingPrice">ราคาขาย</Label>
                {/* No min/step limits: the contract is the one place that rejects bad numbers. */}
                <Input
                  id="sellingPrice"
                  type="number"
                  step="any"
                  required
                  value={sellingPrice}
                  onChange={(e) => setSellingPrice(e.target.value)}
                />
              </div>
              {stores.data?.items.map((store) => (
                <div key={store.id} className="space-y-2">
                  <Label htmlFor={`threshold-${store.id}`}>จุดสั่งซื้อ {store.code}</Label>
                  <Input
                    id={`threshold-${store.id}`}
                    type="number"
                    step="any"
                    value={thresholds[store.id] ?? ''}
                    onChange={(e) => setThresholds({ ...thresholds, [store.id]: e.target.value })}
                  />
                </div>
              ))}
              {saveError && (
                <p role="alert" className="text-sm text-destructive">
                  {errorMessage(saveError)}
                </p>
              )}
              <div className="flex gap-2">
                <Button type="submit" disabled={saving}>
                  {saving ? 'กำลังบันทึก…' : editing ? 'บันทึกการแก้ไข' : 'เพิ่มสินค้า'}
                </Button>
                {editing && (
                  <Button type="button" variant="outline" onClick={resetForm}>
                    ยกเลิก
                  </Button>
                )}
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>รายการสินค้า</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-4">
            <div className="space-y-2">
              <Label htmlFor="search">ค้นหา SKU หรือชื่อ</Label>
              <Input id="search" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="status">สถานะ</Label>
              <select
                id="status"
                className="flex h-9 rounded-md border border-input bg-transparent px-3 text-sm"
                value={status}
                onChange={(e) => setStatus(e.target.value as StatusFilter)}
              >
                <option value="all">ทั้งหมด</option>
                <option value="active">ใช้งาน</option>
                <option value="inactive">ปิดใช้งาน</option>
              </select>
            </div>
          </div>

          {setActive.error && (
            <p role="alert" className="text-sm text-destructive">
              {errorMessage(setActive.error)}
            </p>
          )}

          {products.isPending ? (
            <p className="text-muted-foreground">กำลังโหลด…</p>
          ) : products.isError ? (
            <p role="alert" className="text-destructive">
              โหลดรายการไม่สำเร็จ โปรดลองอีกครั้ง
            </p>
          ) : products.data.items.length === 0 ? (
            <p className="text-muted-foreground">ไม่พบสินค้า</p>
          ) : (
            <ul className="divide-y">
              {products.data.items.map((product) => (
                <li key={product.id} className="flex items-center justify-between py-2">
                  <span className="flex items-center gap-3">
                    <span className="font-medium">{product.name}</span>
                    <span className="text-muted-foreground">{product.sku}</span>
                    <span className="text-muted-foreground">
                      {product.category} · {product.unit} · {product.sellingPrice.toFixed(2)}
                    </span>
                    <Badge variant={product.active ? 'secondary' : 'outline'}>
                      {product.active ? 'ใช้งาน' : 'ปิดใช้งาน'}
                    </Badge>
                  </span>
                  {isAdmin && (
                    <span className="flex gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        aria-label={`แก้ไข ${product.sku}`}
                        onClick={() => startEditing(product)}
                      >
                        แก้ไข
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        aria-label={`${product.active ? 'ปิดใช้งาน' : 'เปิดใช้งาน'} ${product.sku}`}
                        disabled={setActive.isPending}
                        onClick={() =>
                          setActive.mutate({ id: product.id, active: !product.active })
                        }
                      >
                        {product.active ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}
                      </Button>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
