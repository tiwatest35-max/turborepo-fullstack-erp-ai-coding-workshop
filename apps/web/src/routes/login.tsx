import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Navigate, useSearchParams } from 'react-router';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { isUnauthorized, safeRedirect, useSession } from '@/lib/auth';
import { orpc } from '@/lib/orpc';

// Created by packages/database/prisma/seed.ts.
const demoAccounts = [
  { email: 'admin@erp.local', role: 'ADMIN' },
  { email: 'buyer01@erp.local', role: 'PURCHASING' },
  { email: 'manager01@erp.local', role: 'MANAGER' },
  { email: 'staff_b01@erp.local', role: 'STORE_EMPLOYEE' },
  { email: 'staff_b02@erp.local', role: 'STORE_EMPLOYEE' },
];
const DEMO_PASSWORD = 'password';

export function LoginPage() {
  const [searchParams] = useSearchParams();
  const redirectTo = safeRedirect(searchParams.get('redirect'));
  const queryClient = useQueryClient();
  const session = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const login = useMutation(
    orpc.auth.login.mutationOptions({
      // Storing the session re-renders this page, which then redirects below.
      onSuccess: (user) => queryClient.setQueryData(orpc.auth.me.queryKey(), { user }),
    }),
  );

  if (session.data?.user) return <Navigate to={redirectTo} replace />;

  return (
    <div className="flex min-h-svh items-center justify-center bg-muted p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">ERP Workshop</CardTitle>
          <CardDescription>Sign in to continue</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              login.mutate({ email, password });
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </div>
            {login.error && (
              <p role="alert" className="text-sm text-destructive">
                {isUnauthorized(login.error)
                  ? 'Invalid email or password.'
                  : 'Could not sign in. Is the API running?'}
              </p>
            )}
            <Button type="submit" className="w-full" disabled={login.isPending}>
              {login.isPending ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>

          <div className="space-y-2 rounded-md border bg-muted/50 p-3 text-sm">
            <p className="font-medium">Demo accounts (password: {DEMO_PASSWORD})</p>
            {demoAccounts.map((account) => (
              <button
                key={account.email}
                type="button"
                className="flex w-full justify-between text-left text-muted-foreground hover:text-foreground"
                onClick={() => {
                  setEmail(account.email);
                  setPassword(DEMO_PASSWORD);
                }}
              >
                <span>{account.email}</span>
                <span>{account.role}</span>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
