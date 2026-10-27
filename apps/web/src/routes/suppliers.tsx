import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { Supplier } from '@erp/contracts';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useCurrentUser } from '@/lib/auth';
import { orpc } from '@/lib/orpc';

/** Admin screen: list suppliers, add a new one, and edit contact details. */
export function SuppliersPage() {
  const queryClient = useQueryClient();
  const user = useCurrentUser();
  const isAdmin = user?.role === 'ADMIN';
  const suppliers = useQuery(
    orpc.suppliers.list.queryOptions({ input: { page: 1, pageSize: 20 } }),
  );

  const refreshList = () =>
    void queryClient.invalidateQueries({ queryKey: orpc.suppliers.list.key() });

  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactPhone, setContactPhone] = useState('');

  const create = useMutation(
    orpc.suppliers.create.mutationOptions({
      onSuccess: () => {
        setCode('');
        setName('');
        setContactName('');
        setContactPhone('');
        refreshList();
      },
    }),
  );

  // The supplier currently being edited, and the editable phone field.
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [editPhone, setEditPhone] = useState('');

  const update = useMutation(
    orpc.suppliers.update.mutationOptions({
      onSuccess: () => {
        setEditing(null);
        refreshList();
      },
    }),
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">ผู้จัดจำหน่าย</h1>
        <p className="text-muted-foreground">จัดการรหัส ชื่อ และข้อมูลติดต่อของผู้จัดจำหน่าย</p>
      </div>

      {isAdmin && (
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle>เพิ่มผู้จัดจำหน่าย</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                create.mutate({
                  code,
                  name,
                  contactName: contactName || null,
                  contactPhone: contactPhone || null,
                  contactEmail: null,
                });
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
              <div className="space-y-2">
                <Label htmlFor="contactName">ชื่อผู้ติดต่อ</Label>
                <Input
                  id="contactName"
                  value={contactName}
                  onChange={(e) => setContactName(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="contactPhone">โทรศัพท์</Label>
                <Input
                  id="contactPhone"
                  value={contactPhone}
                  onChange={(e) => setContactPhone(e.target.value)}
                />
              </div>
              {create.error && (
                <p role="alert" className="text-sm text-destructive">
                  เพิ่มผู้จัดจำหน่ายไม่สำเร็จ ตรวจสอบว่ารหัสไม่ซ้ำ
                </p>
              )}
              <Button type="submit" disabled={create.isPending}>
                {create.isPending ? 'กำลังบันทึก…' : 'เพิ่มผู้จัดจำหน่าย'}
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
                update.mutate({ id: editing.id, contactPhone: editPhone || null });
              }}
            >
              <div className="space-y-2">
                <Label htmlFor="editPhone">โทรศัพท์ (แก้ไข)</Label>
                <Input
                  id="editPhone"
                  value={editPhone}
                  onChange={(e) => setEditPhone(e.target.value)}
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
          <CardTitle>รายการผู้จัดจำหน่าย</CardTitle>
        </CardHeader>
        <CardContent>
          {suppliers.isPending ? (
            <p className="text-muted-foreground">กำลังโหลด…</p>
          ) : suppliers.isError ? (
            <p role="alert" className="text-destructive">
              โหลดรายการไม่สำเร็จ โปรดลองอีกครั้ง
            </p>
          ) : suppliers.data.items.length === 0 ? (
            <p className="text-muted-foreground">ยังไม่มีผู้จัดจำหน่าย</p>
          ) : (
            <ul className="divide-y">
              {suppliers.data.items.map((supplier) => (
                <li key={supplier.id} className="flex items-center justify-between py-2">
                  <span className="font-medium">{supplier.name}</span>
                  <span className="flex items-center gap-3">
                    <span className="text-muted-foreground">{supplier.code}</span>
                    {isAdmin && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        aria-label={`แก้ไข ${supplier.code}`}
                        onClick={() => {
                          setEditing(supplier);
                          setEditPhone(supplier.contactPhone ?? '');
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
