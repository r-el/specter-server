/**
 * Email Service
 *
 * Wraps @sendgrid/mail to send emails.
 * Abstracts the third-party dependency so the rest of the application
 * only deals with our internal methods like sendWelcomeEmail.
 */

import { injectable } from "tsyringe";
import sgMail from "@sendgrid/mail";
import { config } from "@core/config.js";
import logger from "@core/utils/logger.js";

// Initialize SendGrid if API key is provided
if (config.email.sendgridApiKey) {
  sgMail.setApiKey(config.email.sendgridApiKey);
}

@injectable()
export class EmailService {
  /**
   * Send a general email.
   * Prefer using the specific helper methods below instead of this one directly.
   */
  async sendEmail(options: { to: string; subject: string; text?: string; html?: string }): Promise<boolean> {
    if (!config.email.sendgridApiKey) {
      logger.warn("SendGrid API key not configured, skipping email send", {
        to: options.to,
        subject: options.subject,
      });
      return false; // Silently fail in development if no key
    }

    try {
      await sgMail.send({
        to: options.to,
        from: {
          email: config.email.senderEmail,
          name: config.email.senderName,
        },
        subject: options.subject,
        text: options.text,
        html: options.html,
      });

      logger.info("Email sent successfully", { to: options.to, subject: options.subject });
      return true;
    } catch (error) {
      logger.error("Failed to send email", {
        error: error instanceof Error ? error.message : "unknown",
        to: options.to,
      });
      return false;
    }
  }

  /**
   * Sends an email with a 6-digit verification code.
   */
  async sendVerificationCodeEmail(toEmail: string, name: string, code: string): Promise<boolean> {
    const subject = `Specter - Your Verification Code: ${code}`;
    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 520px; margin: 0 auto; padding: 32px 24px; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px; color: #1e293b;">
        <div style="text-align: center; margin-bottom: 24px;">
          <h1 style="color: #0284c7; font-size: 24px; margin: 0; font-weight: 700; letter-spacing: -0.5px;">Specter Security</h1>
          <p style="color: #64748b; font-size: 14px; margin-top: 4px;">Command Center Email Verification</p>
        </div>
        <p style="font-size: 15px; line-height: 1.6;">Hello <strong>${name}</strong>,</p>
        <p style="font-size: 15px; line-height: 1.6; color: #475569;">Please use the following 6-digit code to verify your email address and activate your operator account:</p>
        <div style="margin: 28px 0; text-align: center;">
          <div style="display: inline-block; padding: 16px 32px; background: #0f172a; color: #38bdf8; font-size: 36px; font-weight: 800; letter-spacing: 12px; border-radius: 12px; font-family: monospace;">
            ${code}
          </div>
        </div>
        <p style="font-size: 13px; color: #94a3b8; text-align: center;">This code will expire in ${config.auth.verificationCodeExpiresInMs / (60 * 1000)} minutes.</p>
        <hr style="border: none; border-top: 1px solid #f1f5f9; margin: 24px 0;" />
        <p style="font-size: 12px; color: #94a3b8; text-align: center; margin: 0;">If you did not request this verification, please disregard this message.</p>
      </div>
    `;

    return this.sendEmail({
      to: toEmail,
      subject,
      text: `Your Specter verification code is: ${code}`,
      html,
    });
  }

  /**
   * Sends a welcome email to a newly registered user.
   */
  async sendWelcomeEmail(toEmail: string, name: string): Promise<boolean> {
    const subject = "Welcome to Specter";
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Welcome to Specter, ${name}!</h2>
        <p>Thank you for registering with Specter.</p>
        <p>Your account has been successfully created and verified. We are excited to have you on board!</p>
        <br>
        <p>Best regards,<br>The Specter Team</p>
      </div>
    `;

    return this.sendEmail({
      to: toEmail,
      subject,
      html,
    });
  }

  /**
   * (Placeholder) Sends a security alert email.
   */
  async sendSecurityAlert(toEmail: string, cameraName: string, details: string): Promise<boolean> {
    const subject = `Specter Security Alert: ${cameraName}`;
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
        <h2 style="color: #e53e3e;">Security Alert Triggered</h2>
        <p>An event was detected on camera <strong>${cameraName}</strong>.</p>
        <p><strong>Details:</strong> ${details}</p>
        <p>Please log in to the Specter dashboard to review this alert.</p>
      </div>
    `;

    return this.sendEmail({
      to: toEmail,
      subject,
      html,
    });
  }
}
