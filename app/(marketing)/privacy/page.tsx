import type { Metadata } from "next";
import { LegalList, LegalPage, LegalSection } from "@/components/marketing/legal";
import { PRODUCT_NAME } from "@/lib/branding";

export const metadata: Metadata = { title: "Privacy Policy" };

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy" effective="September 10, 2026">
      <LegalSection heading="1. Who we are">
        <p>
          {PRODUCT_NAME} (&ldquo;we&rdquo;, &ldquo;us&rdquo;, the &ldquo;Service&rdquo;) is an
          AI-assisted scriptwriting platform for video creators. This policy explains what personal
          data we collect, why we collect it, and the choices you have. It applies to the{" "}
          {PRODUCT_NAME} web application and any related services we operate.
        </p>
      </LegalSection>

      <LegalSection heading="2. Information we collect">
        <LegalList
          items={[
            <span key="a">
              <strong>Account information</strong> — your email address, name, and profile image
              when you sign in with an email link or a Google account.
            </span>,
            <span key="b">
              <strong>Workspace content</strong> — the projects, research notes, uploads, scripts,
              titles, descriptions, and other material you and your team create in the Service.
            </span>,
            <span key="c">
              <strong>YouTube channel data</strong> — if you connect a channel, we retrieve channel
              and video <em>metadata</em> (titles, descriptions, statistics, captions for your own
              channel) through the YouTube Data API. We never store third-party video, audio, or
              thumbnail files — metadata and URLs only.
            </span>,
            <span key="d">
              <strong>Billing information</strong> — payment details are collected and processed by
              Stripe; we never see or store full card numbers.
            </span>,
            <span key="e">
              <strong>Usage and log data</strong> — standard technical logs (request identifiers,
              approximate region, browser type) and product analytics used to keep the Service
              secure and improve it. Logs are scrubbed of personal content.
            </span>,
          ]}
        />
      </LegalSection>

      <LegalSection heading="3. Google user data">
        <p>
          When you connect a Google account, we request the minimum scopes needed: sign-in identity
          and, only if you connect a YouTube channel, read-only access to that channel (
          <code>youtube.readonly</code>). We use this access solely to display your channel in the
          Service, analyze your published content to build your audience profile and voice profile,
          and keep channel statistics current. We do not use Google user data for advertising, and
          we do not sell it.
        </p>
        <p>
          {PRODUCT_NAME}&rsquo;s use and transfer of information received from Google APIs adheres
          to the{" "}
          <a
            className="text-emerald-700 underline dark:text-emerald-400"
            href="https://developers.google.com/terms/api-services-user-data-policy"
          >
            Google API Services User Data Policy
          </a>
          , including the Limited Use requirements. OAuth tokens are encrypted at rest and are never
          shared with third parties. You can disconnect a channel at any time in Settings, or revoke
          access from your Google Account security page; we delete the stored tokens promptly on
          disconnect.
        </p>
      </LegalSection>

      <LegalSection heading="4. How we use information">
        <LegalList
          items={[
            "Provide the Service: generating research briefs, scripts, and packaging from the inputs you supply.",
            "Operate AI features: your prompts and connected-channel metadata are sent to our AI model providers to produce outputs for you; they are not used to train those providers' models under our agreements.",
            "Billing and account management: subscriptions, credit balances, and receipts.",
            "Security and integrity: fraud prevention, rate limiting, debugging, and abuse detection.",
            "Communications: transactional email such as sign-in links and billing notices. Product updates are opt-in.",
          ]}
        />
      </LegalSection>

      <LegalSection heading="5. Sharing">
        <p>
          We do not sell personal data. We share data only with service providers that help us run
          the product — cloud hosting, payment processing (Stripe), email delivery, error
          monitoring, product analytics, and AI model providers — each bound by contracts limiting
          their use of the data to providing their service to us. We may disclose information if
          required by law or to protect the rights, safety, or property of users or the public.
        </p>
      </LegalSection>

      <LegalSection heading="6. Retention and deletion">
        <p>
          Workspace content is retained while your account is active. You can delete projects,
          research documents, and channels in the app at any time. If you close your account, we
          delete or de-identify your personal data within 30 days, except where a longer period is
          required for legal, billing, or security reasons. Backups roll off on a fixed schedule.
        </p>
      </LegalSection>

      <LegalSection heading="7. Your rights">
        <p>
          Depending on where you live, you may have the right to access, correct, export, or delete
          your personal data, and to object to or restrict certain processing. Contact us using the
          details below and we will respond within the timelines required by applicable law. If you
          are in the EEA or UK, you may also lodge a complaint with your supervisory authority.
        </p>
      </LegalSection>

      <LegalSection heading="8. Security">
        <p>
          All traffic is encrypted in transit (TLS). OAuth tokens are encrypted at rest. Access to
          production systems is restricted and audited. No method of storage is perfectly secure; if
          a breach affects your data we will notify you as required by law.
        </p>
      </LegalSection>

      <LegalSection heading="9. Children">
        <p>
          The Service is not directed to children under 16, and we do not knowingly collect personal
          data from them. If you believe a child has provided us data, contact us and we will delete
          it.
        </p>
      </LegalSection>

      <LegalSection heading="10. Changes and contact">
        <p>
          We will post any changes to this policy on this page and, for material changes, notify you
          in the app or by email before they take effect. Questions or requests: contact the{" "}
          {PRODUCT_NAME} team through the support link in the app, or write to the support address
          published on our website.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
