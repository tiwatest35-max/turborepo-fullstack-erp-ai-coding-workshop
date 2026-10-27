import { expect, test as setup } from '@playwright/test';
import { accounts, DEMO_PASSWORD, storageState, type AccountName } from './accounts.js';

// Runs once before the chromium project. Signs in through the API, not the form, so the
// login page is tested in exactly one place: login.e2e.ts.
for (const name of Object.keys(accounts) as AccountName[]) {
  setup(`sign in as ${name}`, async ({ request }) => {
    const response = await request.post('/api/auth/login', {
      data: { email: accounts[name].email, password: DEMO_PASSWORD },
    });
    expect(response.ok(), `login as ${name} returned ${response.status()}`).toBeTruthy();
    await request.storageState({ path: storageState(name) });
  });
}
