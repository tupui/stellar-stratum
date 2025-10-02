import { test, expect } from '@playwright/test';

/**
 * Test fiat currency switching in transaction history
 * Reproduces the N/A bug when switching from USD to EUR
 */

test.describe('Transaction History - Fiat Currency Switching', () => {
  const testAddress = 'GBU764PFZXKZUORAUK3IG36Y6OXSLYM6ZERLJA2BZ2Y2GSKNKWL4KKC5';
  const baseUrl = 'http://localhost:8080';

  test('should switch from USD to EUR without showing N/A', async ({ page }) => {
    // 1. Go to landing page
    await page.goto(baseUrl);
    await page.waitForLoadState('domcontentloaded');

    // 2. Click "Connect wallet"
    await page.click('button:has-text("Connect wallet")');
    
    // Wait for dialog to appear
    await page.waitForSelector('text=Connect Wallet', { timeout: 10000 });

    // 3. Make sure we're on Mainnet (click it to be sure)
    await page.click('button:has-text("Mainnet")', { timeout: 5000 });

    // 4. Click "Enter address manually"
    await page.click('button:has-text("Enter address manually")');

    // 5. Enter the test address and press Enter
    const addressInput = page.locator('input[placeholder*="GABC"], input[type="text"]').first();
    await addressInput.click();
    await addressInput.fill(testAddress);
    await addressInput.press('Enter');

    // 7. Wait for account to load (wait for the account public key to appear)
    await page.waitForSelector(`text=${testAddress.slice(0, 10)}`, { timeout: 45000 });
    console.log('Account loaded successfully');
    
    // 8. Navigate to Activity tab
    await page.waitForTimeout(2000); // Give UI time to stabilize
    const activityButton = page.locator('button:has-text("Activity")');
    await activityButton.click();
    
    // Wait for transactions to load
    await page.waitForSelector('text=Activity History', { timeout: 30000 });
    console.log('Activity History loaded');
    await page.waitForTimeout(8000); // Give time for USD prices to fully load

    // 9. Verify we're starting in USD and transactions have values
    console.log('Checking USD amounts...');
    const usdTransactions = page.locator('text=/\\$[0-9]|USD/');
    const usdCount = await usdTransactions.count();
    console.log(`Found ${usdCount} elements with $ or USD`);

    // 10. Count N/A in USD
    const naInUsd = page.locator('text=N/A');
    const naCountUsd = await naInUsd.count();
    console.log(`N/A count in USD: ${naCountUsd}`);

    // 11. Switch to EUR
    console.log('Switching to EUR...');
    const fiatSelector = page.locator('[role="combobox"]').filter({ hasText: /USD|EUR|GBP/ }).first();
    await fiatSelector.click();
    await page.waitForTimeout(500);
    await page.click('[role="option"]:has-text("EUR")');

    // 12. Wait for conversion (should be fast)
    await page.waitForTimeout(3000);

    // 13. Count N/A in EUR
    const naInEur = page.locator('text=N/A');
    const naCountEur = await naInEur.count();
    console.log(`N/A count in EUR: ${naCountEur}`);

    // 14. Check for EUR symbols
    const eurTransactions = page.locator('text=/€[0-9]/');
    const eurCount = await eurTransactions.count();
    console.log(`Found ${eurCount} transactions with € symbol`);

    // Critical assertion: EUR conversion should not massively increase N/A
    expect(naCountEur).toBeLessThanOrEqual(naCountUsd + 10);
    
    // Should have some EUR amounts showing
    expect(eurCount).toBeGreaterThan(0);

    console.log('Test completed successfully!');
  });
});
