import { Link, Outlet } from 'react-router';
import { MainNav } from '@/components/main-nav';
import { UserMenu } from '@/components/user-menu';

export function RootLayout() {
  return (
    <div className="min-h-svh bg-background text-foreground">
      <header className="border-b">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-6 font-semibold">
          <Link to="/">ERP Workshop</Link>
          <UserMenu />
        </div>
      </header>
      <MainNav />
      <main className="mx-auto max-w-5xl p-6">
        <Outlet />
      </main>
    </div>
  );
}
