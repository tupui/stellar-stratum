import { test, expect } from '@playwright/test';

/**
 * Comprehensive test for fiat currency switching
 * Tests both balance page and transaction history
 * Monitors network calls to verify we're not making unnecessary oracle/contract calls
 */

test.describe('Fiat Currency Switching - Comprehensive', () => {
  const testAddress = 'GBU764PFZXKZUORAUK3IG36Y6OXSLYM6ZERLJA2BZ2Y2GSKNKWL4KKC5';
  const baseUrl = 'http://localhost:8080';

  test('should efficiently switch currencies across balance and history pages', async ({ page }) => {
    // Track network requests
    const networkRequests: { url: string; method: string; timestamp: number }[] = [];
    page.on('request', request => {
      const url = request.url();
      // Track oracle/contract calls and API calls
      if (url.includes('stellar.org') || url.includes('soroban') || url.includes('rpc') || url.includes('horizon')) {
        networkRequests.push({
          url: url.substring(0, 100),
          method: request.method(),
          timestamp: Date.now()
        });
      }
    });

    // Track console messages to see component lifecycle
    const consoleLogs: string[] = [];
    page.on('console', msg => {
      const text = msg.text();
      if (text.includes('[Panel]') || text.includes('MOUNTED') || text.includes('UNMOUNTED')) {
        consoleLogs.push(text);
        console.log(`  BROWSER: ${text}`);
      }
    });

    // 1-5: Connect wallet
    await page.goto(baseUrl);
    await page.waitForLoadState('domcontentloaded');
    await page.click('button:has-text("Connect wallet")');
    await page.waitForSelector('text=Connect Wallet', { timeout: 10000 });
    await page.click('button:has-text("Mainnet")', { timeout: 5000 });
    await page.click('button:has-text("Enter address manually")');
    const addressInput = page.locator('input[placeholder*="GABC"], input[type="text"]').first();
    await addressInput.click();
    await addressInput.fill(testAddress);
    await addressInput.press('Enter');
    await page.waitForSelector(`text=${testAddress.slice(0, 10)}`, { timeout: 45000 });
    console.log('✓ Account loaded');

    // Clear network request log (ignore initial load)
    networkRequests.length = 0;

    // ===== BALANCE PAGE TESTS =====
    console.log('\n=== BALANCE PAGE - Testing Fiat Switching ===');
    
    // Should be on Balances tab by default
    await page.waitForTimeout(3000);
    
    // Check we have USD amounts
    const usdBalances = page.locator('text=/\\$[0-9]+/');
    const usdBalanceCount = await usdBalances.count();
    console.log(`Balances in USD: ${usdBalanceCount} elements with $`);

    // Record network calls before switching
    const requestsBeforeBalanceSwitch = networkRequests.length;
    console.log(`Network requests so far: ${requestsBeforeBalanceSwitch}`);

    // STEP 1: Switch to EUR on Balance page
    console.log('\n[Balance Page] Switching USD → EUR...');
    const fiatSelectorBalance = page.locator('[role="combobox"]').filter({ hasText: /USD|EUR|GBP/ }).first();
    await fiatSelectorBalance.click();
    await page.waitForTimeout(300);
    await page.click('[role="option"]:has-text("EUR")');
    await page.waitForTimeout(2000);

    // Check EUR balances appeared
    const eurBalances = page.locator('text=/€[0-9]+/');
    const eurBalanceCount = await eurBalances.count();
    console.log(`Balances in EUR: ${eurBalanceCount} elements with €`);
    expect(eurBalanceCount).toBeGreaterThan(0);

    // Check network calls after balance switch
    const requestsAfterBalanceSwitch = networkRequests.length;
    const balanceSwitchCalls = requestsAfterBalanceSwitch - requestsBeforeBalanceSwitch;
    console.log(`Network requests for EUR switch on balances: ${balanceSwitchCalls}`);
    
    // Should only call FX oracle (1-2 calls), NOT all asset oracles
    if (balanceSwitchCalls > 5) {
      console.warn(`⚠️ WARNING: Made ${balanceSwitchCalls} network calls just to switch currency!`);
      console.warn('Should only fetch FX rate, not re-fetch all asset prices.');
      networkRequests.slice(requestsBeforeBalanceSwitch).forEach(r => {
        console.log(`  - ${r.method} ${r.url}`);
      });
    }
    expect(balanceSwitchCalls).toBeLessThan(10); // Should be minimal

    // ===== TRANSACTION HISTORY TESTS =====
    console.log('\n=== TRANSACTION HISTORY - Testing Fiat Switching ===');
    
    // STEP 2: Navigate to Activity tab (while in EUR)
    console.log('\n[History Page] Navigating to Activity tab (currently in EUR)...');
    const activityButton = page.locator('button:has-text("Activity")');
    await activityButton.click();
    await page.waitForSelector('text=Activity History', { timeout: 30000 });
    await page.waitForTimeout(8000); // Wait for transactions to load

    // Check EUR amounts on history page
    const eurHistory = page.locator('text=/€[0-9]+\\.[0-9]{2}/');
    const eurHistoryCount = await eurHistory.count();
    console.log(`History in EUR: ${eurHistoryCount} transactions with € amounts`);

    // Get first EUR amount as sample
    let firstEurAmount = 0;
    if (eurHistoryCount > 0) {
      const text = await eurHistory.first().textContent();
      const match = text?.match(/€([\d,]+\.?\d*)/);
      if (match) {
        firstEurAmount = parseFloat(match[1].replace(',', ''));
        console.log(`Sample EUR amount: €${firstEurAmount.toFixed(2)}`);
      }
    }

    const requestsBeforeHistorySwitch = networkRequests.length;

    // STEP 3: Switch to USD on History page
    console.log('\n[History Page] Switching EUR → USD...');
    const fiatSelectorHistory = page.locator('[role="combobox"]').filter({ hasText: /USD|EUR|GBP/ }).first();
    await fiatSelectorHistory.click();
    await page.waitForTimeout(300);
    await page.click('[role="option"]:has-text("USD")');
    await page.waitForTimeout(3000);

    // CRITICAL: Check transaction list is NOT empty
    const usdHistory = page.locator('text=/\\$[0-9]+\\.[0-9]{2}/');
    const usdHistoryCount = await usdHistory.count();
    console.log(`History in USD: ${usdHistoryCount} transactions with $ amounts`);
    
    if (usdHistoryCount === 0) {
      console.error('❌ CRITICAL BUG: Transaction list is EMPTY after switching to USD!');
      console.error('User has to manually refresh to see transactions again.');
    }
    expect(usdHistoryCount).toBeGreaterThan(0);

    // Get first USD amount as sample
    let firstUsdAmount = 0;
    if (usdHistoryCount > 0) {
      const text = await usdHistory.first().textContent();
      const match = text?.match(/\$([\d,]+\.?\d*)/);
      if (match) {
        firstUsdAmount = parseFloat(match[1].replace(',', ''));
        console.log(`Sample USD amount: $${firstUsdAmount.toFixed(2)}`);
      }
    }

    const requestsAfterUsdSwitch = networkRequests.length;
    const usdSwitchCalls = requestsAfterUsdSwitch - requestsBeforeHistorySwitch;
    console.log(`Network requests for USD switch: ${usdSwitchCalls}`);

    // STEP 4: Switch back to EUR on History page
    console.log('\n[History Page] Switching USD → EUR (second time)...');
    const requestsBeforeSecondEur = networkRequests.length;
    
    await fiatSelectorHistory.click();
    await page.waitForTimeout(300);
    await page.click('[role="option"]:has-text("EUR")');
    
    // Check immediately after switch
    await page.waitForTimeout(500);
    let eurHistory2 = page.locator('text=/€[0-9]+\\.[0-9]{2}/');
    let eurHistoryCount2 = await eurHistory2.count();
    console.log(`  After 500ms: ${eurHistoryCount2} EUR transactions`);
    
    await page.waitForTimeout(1000);
    eurHistory2 = page.locator('text=/€[0-9]+\\.[0-9]{2}/');
    eurHistoryCount2 = await eurHistory2.count();
    console.log(`  After 1500ms: ${eurHistoryCount2} EUR transactions`);
    
    await page.waitForTimeout(1500);
    eurHistory2 = page.locator('text=/€[0-9]+\\.[0-9]{2}/');
    eurHistoryCount2 = await eurHistory2.count();
    console.log(`  After 3000ms: ${eurHistoryCount2} elements with EUR amounts`);
    
    // Check the actual transaction list (not portfolio value)
    const actualTransactions = page.locator('div').filter({ hasText: /Sent|Received|swap|payment|XLM|USDC/ });
    const actualTxCount = await actualTransactions.count();
    console.log(`  Actual transaction items in list: ${actualTxCount}`);
    
    // Check what text is shown
    const noTransactionsMsg = page.locator('text=No transactions found');
    const hasNoTransactionsMsg = await noTransactionsMsg.isVisible();
    console.log(`  "No transactions found" message visible: ${hasNoTransactionsMsg}`);
    
    if (hasNoTransactionsMsg) {
      console.error('❌ UI is showing "No transactions found" - this is the bug!');
    }
    
    // Take screenshot
    await page.screenshot({ path: 'test-results/eur-switch-bug.png', fullPage: true });
    
    if (eurHistoryCount2 === 0) {
      console.error('❌ CRITICAL BUG: Transaction list is EMPTY after switching back to EUR!');
      console.error('This is the bug where user has to manually refresh.');
    }
    
    // The transaction count should be similar to first EUR switch
    if (eurHistoryCount2 < eurHistoryCount / 2) {
      console.error(`❌ BUG: Transaction count dropped from ${eurHistoryCount} to ${eurHistoryCount2}!`);
    }
    
    expect(eurHistoryCount2).toBeGreaterThan(10);

    // Get EUR amount again
    let secondEurAmount = 0;
    if (eurHistoryCount2 > 0) {
      const text = await eurHistory2.first().textContent();
      const match = text?.match(/€([\d,]+\.?\d*)/);
      if (match) {
        secondEurAmount = parseFloat(match[1].replace(',', ''));
        console.log(`Sample EUR amount (2nd time): €${secondEurAmount.toFixed(2)}`);
      }
    }

    const requestsAfterSecondEur = networkRequests.length;
    const eurSwitchCalls2 = requestsAfterSecondEur - requestsBeforeSecondEur;
    console.log(`Network requests for EUR switch (2nd time): ${eurSwitchCalls2}`);

    // Verify conversion ratios
    console.log('\n=== Verifying Conversion Ratios ===');
    if (firstUsdAmount > 0 && firstEurAmount > 0) {
      const ratio = firstEurAmount / firstUsdAmount;
      console.log(`First EUR/USD ratio: ${ratio.toFixed(4)}`);
      expect(ratio).toBeGreaterThan(0.7);
      expect(ratio).toBeLessThan(1.3);
    }

    if (firstUsdAmount > 0 && secondEurAmount > 0) {
      const ratio2 = secondEurAmount / firstUsdAmount;
      console.log(`Second EUR/USD ratio: ${ratio2.toFixed(4)}`);
      expect(ratio2).toBeGreaterThan(0.7);
      expect(ratio2).toBeLessThan(1.3);
      
      // Both EUR amounts should be the same (same FX rate)
      if (firstEurAmount > 0 && secondEurAmount > 0) {
        const diff = Math.abs(firstEurAmount - secondEurAmount);
        console.log(`EUR amount consistency: €${firstEurAmount.toFixed(2)} vs €${secondEurAmount.toFixed(2)} (diff: €${diff.toFixed(2)})`);
        expect(diff).toBeLessThan(1); // Should be very close
      }
    }

    // STEP 5: Switch to GBP to test another currency
    console.log('\n[History Page] Switching EUR → GBP...');
    await fiatSelectorHistory.click();
    await page.waitForTimeout(300);
    await page.click('[role="option"]:has-text("GBP")');
    await page.waitForTimeout(3000);

    const gbpHistory = page.locator('text=/£[0-9]+\\.[0-9]{2}/');
    const gbpHistoryCount = await gbpHistory.count();
    console.log(`History in GBP: ${gbpHistoryCount} transactions with £ amounts`);
    expect(gbpHistoryCount).toBeGreaterThan(0);

    // Final summary
    console.log('\n=== Network Call Summary ===');
    console.log(`Total network requests during test: ${networkRequests.length}`);
    console.log(`Balance page EUR switch: ${balanceSwitchCalls} calls`);
    console.log(`History page USD switch: ${usdSwitchCalls} calls`);
    console.log(`History page EUR switch (2nd): ${eurSwitchCalls2} calls`);
    
    console.log('\n✓ All fiat currency switching tests passed!');
  });
});

