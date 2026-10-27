import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { Store } from '@erp/contracts';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useCurrentUser } from '@/lib/auth';
import { orpc } from '@/lib/orpc';

/** Admin screen: list stores, add a new one, and rename an existing one. */
export function StoresPage() {
  const queryClient = useQueryClient();
  const user = useCurrentUser();
  const isAdmin = user?.role === 'ADMIN';
  const stores = useQuery(orpc.stores.list.queryOptions({ input: { page: 1, pageSize: 20 } }));

  const refreshList = () =>
    void queryClient.invalidateQueries({ queryKey: orpc.stores.list.key() });

  const [code, setCode] = useState('');
  const [name, setName] = useState('');

  const create = useMutation(
    orpc.stores.create.mutationOptions({
      onSuccess: () => {
        setCode('');
        setName('');
        refreshList();
      },
    }),
  );

  // The store currently being edited, and the editable name field.
  const [editing, setEditing] = useState<Store | null>(null);
  const [editName, setEditName] = useState('');

  const update = useMutation(
    orpc.stores.update.mutationOptions({
      onSuccess: () => {
        setEditing(null);
        refreshList();
      },
    }),
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">สาขา</h1>
        <p className="text-muted-foreground">จัดการรหัสและชื่อสาขา</p>
      </div>

      {isAdmin && (
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle>เพิ่มสาขา</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                create.mutate({ code, name });
              }}
            >
              <div className="space-y-2">
                <Label htmlFor="code">รหัส</Label>
                <Input id="code" required value={code} onChange={(e) => setCode(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="name">ชื่อ</Label>
                <Input id="name" required value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              {create.error && (
                <p role="alert" className="text-sm text-destructive">
                  เพิ่มสาขาไม่สำเร็จ ตรวจสอบว่ารหัสไม่ซ้ำ
                </p>
              )}
              <Button type="submit" disabled={create.isPending}>
                {create.isPending ? 'กำลังบันทึก…' : 'เพิ่มสาขา'}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {isAdmin && editing && (
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle>แก้ไข {editing.code}</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                update.mutate({ id: editing.id, name: editName });
              }}
            >
              <div className="space-y-2">
                <Label htmlFor="editName">ชื่อ (แก้ไข)</Label>
                <Input
                  id="editName"
                  required
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                />
              </div>
              {update.error && (
                <p role="alert" className="text-sm text-destructive">
                  บันทึกการแก้ไขไม่สำเร็จ โปรดลองอีกครั้ง
                </p>
              )}
              <div className="flex gap-2">
                <Button type="submit" disabled={update.isPending}>
                  {update.isPending ? 'กำลังบันทึก…' : 'บันทึกการแก้ไข'}
                </Button>
                <Button type="button" variant="outline" onClick={() => setEditing(null)}>
                  ยกเลิก
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>รายการสาขา</CardTitle>
        </CardHeader>
        <CardContent>
          {stores.isPending ? (
            <p className="text-muted-foreground">กำลังโหลด…</p>
          ) : stores.isError ? (
            <p role="alert" className="text-destructive">
              โหลดรายการไม่สำเร็จ โปรดลองอีกครั้ง
            </p>
          ) : stores.data.items.length === 0 ? (
            <p className="text-muted-foreground">ยังไม่มีสาขา</p>
          ) : (
            <ul className="divide-y">
              {stores.data.items.map((store) => (
                <li key={store.id} className="flex items-center justify-between py-2">
                  <span className="font-medium">{store.name}</span>
                  <span className="flex items-center gap-3">
                    <span className="text-muted-foreground">{store.code}</span>
                    {isAdmin && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        aria-label={`แก้ไข ${store.code}`}
                        onClick={() => {
                          setEditing(store);
                          setEditName(store.name);
                        }}
                      >
                        แก้ไข
                      </Button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
