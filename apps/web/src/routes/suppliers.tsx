import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { orpc } from '@/lib/orpc';

/** Admin screen: list suppliers and add a new one. Create is admin-only at the API. */
export function SuppliersPage() {
  const queryClient = useQueryClient();
  const suppliers = useQuery(
    orpc.suppliers.list.queryOptions({ input: { page: 1, pageSize: 20 } }),
  );

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
        void queryClient.invalidateQueries({ queryKey: orpc.suppliers.list.key() });
      },
    }),
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">ผู้จัดจำหน่าย</h1>
        <p className="text-muted-foreground">จัดการรหัส ชื่อ และข้อมูลติดต่อของผู้จัดจำหน่าย</p>
      </div>

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
                <li key={supplier.id} className="flex justify-between py-2">
                  <span className="font-medium">{supplier.name}</span>
                  <span className="text-muted-foreground">{supplier.code}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
