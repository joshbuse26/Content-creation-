import type { Metadata } from "next";
import { LegalList, LegalPage, LegalSection } from "@/components/marketing/legal";
import { PRODUCT_NAME } from "@/lib/branding";

export const metadata: Metadata = { title: "Terms of Service" };

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Service" effective="September 10, 2026">
      <LegalSection heading="1. Agreement">
        <p>
          These Terms of Service (&ldquo;Terms&rdquo;) govern your use of {PRODUCT_NAME} (the
          &ldquo;Service&rdquo;). By creating an account or using the Service you agree to these
          Terms. If you use the Service on behalf of an organization, you represent that you have
          authority to bind that organization, and &ldquo;you&rdquo; refers to it.
        </p>
      </LegalSection>

      <LegalSection heading="2. The Service">
        <p>
          {PRODUCT_NAME} provides AI-assisted research, script drafting, revision, and packaging
          tools for video creators. Features may change as the Service evolves; we will not
          materially reduce core paid functionality during a paid term without notice.
        </p>
      </LegalSection>

      <LegalSection heading="3. Accounts and workspaces">
        <LegalList
          items={[
            "You must provide accurate account information and keep your sign-in method secure. You are responsible for activity under your account.",
            "Workspace owners and admins control member access. Content in a workspace is visible to its members according to their roles.",
            "You must be at least 16 years old (or the age of digital consent in your country) to use the Service.",
          ]}
        />
      </LegalSection>

      <LegalSection heading="4. Your content and AI outputs">
        <LegalList
          items={[
            "You retain all rights to the material you upload and the inputs you provide. You grant us a limited license to host and process that material solely to operate the Service.",
            "As between you and us, you own the scripts, titles, descriptions, and other outputs generated for you, to the extent permitted by law. You are responsible for reviewing outputs before publishing them.",
            "AI outputs can be inaccurate. Fact-check flags in the editor are an aid, not a guarantee. Do not rely on outputs as professional advice.",
            "You are responsible for ensuring you have rights to any third-party material you import (transcripts, documents, voice samples) and that your use of outputs complies with the policies of the platforms where you publish.",
          ]}
        />
      </LegalSection>

      <LegalSection heading="5. Acceptable use">
        <p>You agree not to:</p>
        <LegalList
          items={[
            "use the Service to create content that is unlawful, defamatory, or deceptively impersonates another person or creator without authorization;",
            "circumvent usage limits, credits, rate limits, or security controls, or probe or disrupt the Service;",
            "resell or provide the Service to third parties except through seats in your workspace;",
            "scrape or bulk-extract data from the Service, or use it to build a competing dataset.",
          ]}
        />
      </LegalSection>

      <LegalSection heading="6. Third-party services">
        <p>
          Connecting a YouTube channel uses the YouTube API Services. By connecting, you also agree
          to the YouTube Terms of Service and acknowledge the Google Privacy Policy. You can revoke
          {` ${PRODUCT_NAME}'s`} access at any time in Settings or from your Google Account security
          settings.
        </p>
      </LegalSection>

      <LegalSection heading="7. Plans, credits, and billing">
        <LegalList
          items={[
            "Paid plans are billed in advance on a monthly subscription through Stripe. Prices are shown before you subscribe.",
            "Generation features consume credits (for example, a full script draft costs 6 credits). Monthly credit allowances reset each billing cycle and do not roll over unless stated otherwise.",
            "If a generation fails on our side, the corresponding credits are refunded to your balance automatically.",
            "If a payment fails, we may downgrade or suspend paid features after a grace period. You can cancel at any time; cancellation takes effect at the end of the current billing period.",
          ]}
        />
      </LegalSection>

      <LegalSection heading="8. Termination">
        <p>
          You may stop using the Service and delete your account at any time. We may suspend or
          terminate access for breach of these Terms, for legal reasons, or for extended
          non-payment, with notice where practicable. Sections that by their nature should survive
          termination (including content ownership, disclaimers, and limitations of liability)
          survive.
        </p>
      </LegalSection>

      <LegalSection heading="9. Disclaimers">
        <p>
          The Service is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo;. To the maximum
          extent permitted by law, we disclaim all warranties, express or implied, including
          merchantability, fitness for a particular purpose, and non-infringement. We do not warrant
          that outputs will be accurate, original in all respects, or fit for publication without
          review.
        </p>
      </LegalSection>

      <LegalSection heading="10. Limitation of liability">
        <p>
          To the maximum extent permitted by law, neither party is liable for indirect, incidental,
          special, consequential, or punitive damages, or lost profits or revenues. Our aggregate
          liability arising out of the Service is limited to the amounts you paid us in the twelve
          months before the event giving rise to the claim (or USD 100 if you have paid nothing).
          Nothing in these Terms limits liability that cannot be limited by law.
        </p>
      </LegalSection>

      <LegalSection heading="11. Changes to these Terms">
        <p>
          We may update these Terms from time to time. For material changes we will give at least 14
          days&rsquo; notice in the app or by email. Continued use after the effective date
          constitutes acceptance. If you do not agree, stop using the Service before the changes
          take effect.
        </p>
      </LegalSection>

      <LegalSection heading="12. Contact">
        <p>
          Questions about these Terms: contact the {PRODUCT_NAME} team through the support link in
          the app, or write to the support address published on our website.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
