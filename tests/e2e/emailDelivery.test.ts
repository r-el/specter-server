import "reflect-metadata";
import { describe, it, expect, beforeAll } from "vitest";
import { EmailService } from "../../src/services/email/emailService.js";
import { TestmailAppClient } from "../../src/services/email/testmailClient.js";
import { config } from "../../src/core/config.js";

/**
 * End-to-End Test: Email Delivery
 *
 * Verifies that the EmailService correctly sends an email through SendGrid,
 * and that the email arrives at the destination using testmail.app.
 *
 * Note: Requires SENDGRID_API_KEY, TESTMAIL_API_KEY, and TESTMAIL_NAMESPACE
 * to be set in the .env file.
 */
describe("E2E: Email Delivery", () => {
  let emailService: EmailService;
  let testmailClient: TestmailAppClient;

  beforeAll(() => {
    emailService = new EmailService();
    testmailClient = new TestmailAppClient();
  });

  const hasApiKeys = !!(config.email.sendgridApiKey && config.email.testmail.apiKey && config.email.testmail.namespace);

  it.skipIf(!hasApiKeys)(
    "should send a welcome email and receive it at testmail.app",
    async () => {
      // 1. Arrange
      const tag = `welcome-test-${Date.now()}`;
      const targetEmail = testmailClient.generateEmailAddress(tag);
      const testUserName = "E2E Tester";

      // 2. Act (Send Email)
      const sendSuccess = await emailService.sendWelcomeEmail(targetEmail, testUserName);
      expect(sendSuccess).toBe(true);

      // 3. Assert (Wait for Email to arrive)
      // livequery=true means this will hang until it arrives or times out (testmail default is 60s)
      const receivedEmail = await testmailClient.waitForEmail(tag);

      expect(receivedEmail).toBeDefined();
      expect(receivedEmail?.subject).toContain("Welcome to Specter");
      expect(receivedEmail?.html).toContain(testUserName);
      expect(receivedEmail?.to).toBe(targetEmail);
    },
    60000,
  ); // 60 seconds timeout to allow for network / delivery delays
});
