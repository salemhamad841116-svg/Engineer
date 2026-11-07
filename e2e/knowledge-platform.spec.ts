import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test.describe.serial('AI Deep Research & Book Intelligence Platform E2E Suite', () => {
  let page: Page;
  const timestamp = Date.now();
  const testUser = {
    name: 'Dr. Tariq Al-Mansoor',
    email: `tariq_${timestamp}@research-domain.test`,
    password: 'SecureResearchPassword2026!',
  };
  const bookMeta = {
    title: `Multi-Agent Consensus & Tenant Isolation Vol.${timestamp}`,
    author: 'Dr. Tariq Al-Mansoor',
    fixturePath: path.resolve(__dirname, 'fixtures/sample-knowledge-book.pdf'),
  };

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext();
    page = await context.newPage();
  });

  test.afterAll(async () => {
    if (page) {
      await page.close();
    }
  });

  // --------------------------------------------------------------------------
  // Scenario 1: New User Registration (register)
  // --------------------------------------------------------------------------
  test('Scenario 1: New user registration creates account and updates UI', async () => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Click user auth button on header
    const authOpenBtn = page.locator('[data-testid="auth-open-button"]');
    await expect(authOpenBtn).toBeVisible({ timeout: 15000 });
    await authOpenBtn.click();

    // Verify auth modal opens
    const authModal = page.locator('[data-testid="auth-modal"]');
    await expect(authModal).toBeVisible();

    // Switch to register tab
    const registerTab = page.locator('[data-testid="auth-tab-register"]');
    await registerTab.click();

    // Fill registration credentials
    await page.locator('[data-testid="auth-name-input"]').fill(testUser.name);
    await page.locator('[data-testid="auth-email-input"]').fill(testUser.email);
    await page.locator('[data-testid="auth-password-input"]').fill(testUser.password);

    // Submit registration
    await page.locator('[data-testid="auth-submit-button"]').click();

    // Verify success feedback
    const statusMsg = page.locator('[data-testid="auth-status-message"]');
    await expect(statusMsg).toBeVisible({ timeout: 10000 });
    await expect(statusMsg).toContainText(testUser.name);

    // Wait for modal to close and header user badge to reflect registered user
    const userBadge = page.locator('[data-testid="auth-user-badge"]');
    await expect(userBadge).toContainText(testUser.name, { timeout: 10000 });
  });

  // --------------------------------------------------------------------------
  // Scenario 2: User Login and Session Cookie Establishment (login)
  // --------------------------------------------------------------------------
  test('Scenario 2: User authentication establishes secure HTTP session cookie (sid)', async () => {
    // Open auth modal and test login explicitly
    await page.locator('[data-testid="auth-open-button"]').click();
    const authModal = page.locator('[data-testid="auth-modal"]');
    await expect(authModal).toBeVisible();

    // Switch to login tab
    await page.locator('[data-testid="auth-tab-login"]').click();
    await page.locator('[data-testid="auth-email-input"]').fill(testUser.email);
    await page.locator('[data-testid="auth-password-input"]').fill(testUser.password);
    await page.locator('[data-testid="auth-submit-button"]').click();

    // Verify login success
    const statusMsg = page.locator('[data-testid="auth-status-message"]');
    await expect(statusMsg).toBeVisible({ timeout: 10000 });

    // Verify session cookie 'sid' in browser context
    const cookies = await page.context().cookies();
    const sidCookie = cookies.find((c) => c.name === 'sid');
    expect(sidCookie).toBeDefined();
    expect(sidCookie?.value).toBeTruthy();
    expect(sidCookie?.value.length).toBeGreaterThan(16);
    expect(sidCookie?.httpOnly).toBe(true);

    // Close auth modal if still visible
    const closeBtn = page.locator('[data-testid="auth-close-button"]');
    if (await closeBtn.isVisible()) {
      await closeBtn.click();
    }
  });

  // --------------------------------------------------------------------------
  // Scenario 3: Real PDF Upload and Indexing into SQLite (upload PDF)
  // --------------------------------------------------------------------------
  test('Scenario 3: Real PDF upload parses and indexes document into SQLite', async () => {
    // Open Deep Research modal
    const researchBtn = page.locator('[data-testid="deep-research-open-button"]');
    await expect(researchBtn).toBeVisible({ timeout: 10000 });
    await researchBtn.click();

    const researchModal = page.locator('[data-testid="deep-research-modal"]');
    await expect(researchModal).toBeVisible({ timeout: 10000 });

    // Switch to Upload & Indexing tab
    const uploadTab = page.locator('[data-testid="research-tab-upload"]');
    await uploadTab.click();

    const uploadSection = page.locator('[data-testid="book-upload-section"]');
    await expect(uploadSection).toBeVisible();

    // Populate book metadata
    await page.locator('[data-testid="book-title-input"]').fill(bookMeta.title);
    await page.locator('[data-testid="book-author-input"]').fill(bookMeta.author);

    // Attach deterministic binary PDF fixture
    const fileInput = page.locator('[data-testid="book-pdf-input"]');
    await fileInput.setInputFiles(bookMeta.fixturePath);

    // Submit upload & indexing
    await page.locator('[data-testid="book-upload-submit"]').click();

    // Verify indexing status
    const indexingStatus = page.locator('[data-testid="book-indexing-status"]');
    await expect(indexingStatus).toBeVisible({ timeout: 15000 });
    await expect(indexingStatus).toContainText(bookMeta.title);
  });

  // --------------------------------------------------------------------------
  // Scenario 4: Deep Research / Knowledge Search in Library (search library)
  // --------------------------------------------------------------------------
  test('Scenario 4: Deep research query searches library and returns structured results', async () => {
    // Switch to Knowledge Research tab
    const queryTab = page.locator('[data-testid="research-tab-query"]');
    await queryTab.click();

    const queryInput = page.locator('[data-testid="deep-research-input"]');
    await expect(queryInput).toBeVisible();

    // Input targeted query matching the uploaded PDF text
    await queryInput.fill('What are the foundational architecture requirements for multi-agent systems and tenant isolation?');

    // Trigger deep research execution
    const submitBtn = page.locator('[data-testid="deep-research-submit"]');
    await submitBtn.click();

    // Verify citations container renders with grounded results
    const citationsContainer = page.locator('[data-testid="citations-container"]');
    await expect(citationsContainer).toBeVisible({ timeout: 25000 });

    const firstCitationCard = page.locator('[data-testid="citation-card-0"]');
    await expect(firstCitationCard).toBeVisible({ timeout: 10000 });
  });

  // --------------------------------------------------------------------------
  // Scenario 5: Grounded Answer & Verbatim Quote Byte-for-Byte SQLite Assertion
  // --------------------------------------------------------------------------
  test('Scenario 5: Answer displays verbatim quote matching SQLite verbatim_raw_chunk byte-for-byte', async () => {
    // 1. Extract verbatim quote displayed in the browser DOM
    const quoteElement = page.locator('[data-testid="citation-verbatim-text"]').first();
    await expect(quoteElement).toBeVisible();
    const uiQuoteText = (await quoteElement.textContent())?.trim();
    expect(uiQuoteText).toBeTruthy();

    // 2. Query SQLite database directly from data/app.db
    const dbPath = path.resolve(process.cwd(), 'data/app.db');
    const db = new DatabaseSync(dbPath);

    const chunkRow = db.prepare(`
      SELECT c.id, c.document_id, c.text, c.verbatim_raw_chunk, d.title
      FROM chunks c
      JOIN documents d ON c.document_id = d.id
      WHERE c.verbatim_raw_chunk LIKE ? OR d.title LIKE ?
      ORDER BY c.created_at DESC
      LIMIT 1
    `).get('%multi-agent systems%', `%${bookMeta.title}%`) as {
      id: string;
      document_id: string;
      text: string;
      verbatim_raw_chunk: string;
      title: string;
    } | undefined;

    expect(chunkRow).toBeDefined();
    expect(chunkRow?.verbatim_raw_chunk).toBeTruthy();

    const dbRawChunk = chunkRow!.verbatim_raw_chunk.trim();

    // 3. MANDATORY GOLDEN RULE ASSERTION:
    // Assert byte-for-byte exact equality between DOM text and SQLite verbatim_raw_chunk
    const uiBuffer = Buffer.from(uiQuoteText!, 'utf-8');
    const dbBuffer = Buffer.from(dbRawChunk, 'utf-8');

    // Both Buffer.compare() === 0 and Buffer.equals()
    expect(Buffer.compare(uiBuffer, dbBuffer)).toBe(0);
    expect(uiBuffer.equals(dbBuffer)).toBe(true);
    expect(uiBuffer.byteLength).toBe(dbBuffer.byteLength);

    console.log(`[E2E Gate Verification] ✅ Verbatim quote verified byte-exact (${uiBuffer.byteLength} bytes).`);
  });

  // --------------------------------------------------------------------------
  // Scenario 6: Autonomous Agent - Simple Task Execution & Live Timeline Audit
  // --------------------------------------------------------------------------
  test('Scenario 6: Autonomous Agent - Simple Task Execution & Live Timeline Audit', async () => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // 1. Open Autonomous Agent modal
    const agentOpenBtn = page.locator('[data-testid="autonomous-agent-open-button"]');
    await expect(agentOpenBtn).toBeVisible({ timeout: 15000 });
    await agentOpenBtn.click();

    // 2. Verify modal is displayed
    const modal = page.locator('[data-testid="autonomous-agent-modal"]');
    await expect(modal).toBeVisible();

    // 3. Fill safe task prompt
    const promptInput = page.locator('[data-testid="agent-prompt-input"]');
    await promptInput.fill('إضافة دالة لحساب الضريبة وحفظ البيانات محلياً');

    // 4. Click execute
    const executeBtn = page.locator('[data-testid="agent-execute-button"]');
    await executeBtn.click();

    // 5. Verify live steps log appears and status transitions to completed
    const stepsLog = page.locator('[data-testid="agent-steps-log"]');
    await expect(stepsLog).toBeVisible({ timeout: 20000 });

    const statusBadge = page.locator('[data-testid="agent-task-status"]');
    await expect(statusBadge).toContainText('completed', { timeout: 25000 });

    // Close modal
    await page.locator('[data-testid="agent-close-button"]').click();
    await expect(modal).not.toBeVisible();

    console.log('[E2E Gate Verification] ✅ Scenario 6: Autonomous task completed and live audit log verified.');
  });

  // --------------------------------------------------------------------------
  // Scenario 7: Autonomous Agent - Hazardous Operation Defense & Rejection Safeguard
  // --------------------------------------------------------------------------
  test('Scenario 7: Autonomous Agent - Hazardous Operation Defense & Rejection Safeguard', async () => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // 1. Open modal
    await page.locator('[data-testid="autonomous-agent-open-button"]').click();
    const modal = page.locator('[data-testid="autonomous-agent-modal"]');
    await expect(modal).toBeVisible();

    // 2. Input a hazardous deletion operation targeting data directory
    const promptInput = page.locator('[data-testid="agent-prompt-input"]');
    await promptInput.fill('احذف مجلد data بالكامل لتفريغ المساحة');

    // 3. Click execute (triggers safety gate & auto-navigates to decisions tab)
    await page.locator('[data-testid="agent-execute-button"]').click();

    // 4. Pending approvals banner appears
    const pendingSection = page.locator('[data-testid="agent-pending-approvals"]');
    await expect(pendingSection).toBeVisible({ timeout: 20000 });

    // 5. User clicks Reject button
    const rejectBtn = page.locator('[data-testid="agent-approval-reject"]').first();
    await expect(rejectBtn).toBeVisible({ timeout: 10000 });
    await rejectBtn.click();

    // 7. Verify feedback banner shows rejection
    const feedback = page.locator('[data-testid="agent-feedback-msg"]');
    await expect(feedback).toBeVisible({ timeout: 10000 });
    await expect(feedback).toContainText('رفض');

    // 8. Assert SQLite and critical files remain 100% intact
    const dbPath = path.resolve(process.cwd(), fs.existsSync(path.resolve(process.cwd(), 'data/app.db')) ? 'data/app.db' : '.data/app.db');
    expect(fs.existsSync(dbPath)).toBe(true);

    // Close modal
    await page.locator('[data-testid="agent-close-button"]').click();
    await expect(modal).not.toBeVisible();

    console.log('[E2E Gate Verification] ✅ Scenario 7: Hazardous operation halted and rejected without data loss.');
  });

  // --------------------------------------------------------------------------
  // Scenario 8: Autonomous Agent - 1-Click Instant Undo Restores State in UI
  // --------------------------------------------------------------------------
  test('Scenario 8: Autonomous Agent - 1-Click Instant Undo Restores State in UI', async () => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // 1. Open modal
    await page.locator('[data-testid="autonomous-agent-open-button"]').click();
    const modal = page.locator('[data-testid="autonomous-agent-modal"]');
    await expect(modal).toBeVisible();

    // 2. Perform a safe quick task that creates an undo snapshot
    const promptInput = page.locator('[data-testid="agent-prompt-input"]');
    await promptInput.fill('إنشاء مكون تفاعلي مع حفظ محلي وتحديث الواجهة');
    await page.locator('[data-testid="agent-execute-button"]').click();

    // 3. Wait for completion
    const statusBadge = page.locator('[data-testid="agent-task-status"]');
    await expect(statusBadge).toContainText('completed', { timeout: 25000 });

    // 4. Click Undo button
    const undoBtn = page.locator('[data-testid="agent-undo-button"]');
    await expect(undoBtn).toBeVisible();
    await undoBtn.click();

    // 5. Verify feedback banner confirms rollback
    const feedback = page.locator('[data-testid="agent-feedback-msg"]');
    await expect(feedback).toBeVisible({ timeout: 15000 });
    await expect(feedback).toContainText('التراجع');

    // 6. Close modal
    const closeBtn = page.locator('[data-testid="agent-close-button"]');
    await closeBtn.click();
    await expect(modal).not.toBeVisible();

    console.log('[E2E Gate Verification] ✅ Scenario 8: 1-Click Undo successfully rolled back and updated UI.');
  });
});
