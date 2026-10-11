/**
 * TestmailAppClient
 *
 * An HTTP client that wraps the testmail.app API.
 * Used exclusively for End-to-End (E2E) testing of email workflows.
 * Decoupled from the testing framework (Vitest) so it can be reused.
 */

import { config } from "@core/config.js";
import logger from "@core/utils/logger.js";

export interface TestmailEmail {
  subject: string;
  from: string;
  to: string;
  html: string;
  text: string;
  downloadUrl: string;
}

export class TestmailAppClient {
  private readonly baseUrl = "https://api.testmail.app/api/json";

  constructor(
    private apiKey: string = config.email.testmail.apiKey,
    private namespace: string = config.email.testmail.namespace,
  ) {
    if (!this.apiKey || !this.namespace) {
      logger.warn("TestmailAppClient is missing apiKey or namespace configuration");
    }
  }

  /**
   * Generates a dynamic test email address for this namespace.
   * @param tag - A unique tag for this test run (e.g. `user-signup-${Date.now()}`)
   */
  generateEmailAddress(tag: string): string {
    return `${this.namespace}.${tag}@inbox.testmail.app`;
  }

  /**
   * Fetches an email from testmail.app using live queries.
   * `livequery=true` holds the connection open until an email matching the tag arrives.
   *
   * @param tag - The tag used to identify the specific email.
   * @returns The latest email matching the tag, or null if none found.
   */
  async waitForEmail(tag: string): Promise<TestmailEmail | null> {
    const url = new URL(this.baseUrl);
    url.searchParams.append("apikey", this.apiKey);
    url.searchParams.append("namespace", this.namespace);
    url.searchParams.append("tag", tag);
    url.searchParams.append("livequery", "true");

    try {
      const response = await fetch(url.toString(), {
        method: "GET",
        headers: { "Content-Type": "application/json" },
      });

      if (!response.ok) {
        throw new Error(`Testmail API Error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();

      if (data && data.emails && data.emails.length > 0) {
        return data.emails[0] as TestmailEmail;
      }
      return null;
    } catch (error) {
      logger.error("Error fetching email from testmail.app", { error });
      throw error;
    }
  }
}
