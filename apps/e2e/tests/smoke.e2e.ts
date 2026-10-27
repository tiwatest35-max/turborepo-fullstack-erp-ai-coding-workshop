import { expect, test } from '@playwright/test';

// The one test that ships with the scaffold: the app is up and serves the login page.
// Lesson 10 has the agent write the real Demo: line test next to this file.
test('the login page renders', async ({ page }) => {
  await page.goto('/login');

  await expect(page.getByText('ERP Workshop')).toBeVisible();
  await expect(page.getByLabel('Email')).toBeVisible();
  await expect(page.getByLabel('Password')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
});
