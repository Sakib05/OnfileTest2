import {
  LEGAL_CONFIG,
  copyrightContact,
  isLegalValueSet,
  legalValue,
  type LegalConfig,
} from "@/config/legal";
import {
  MIN_WITHDRAWAL_USD,
  SUPPORTED_WITHDRAWAL_CURRENCIES,
  SUPPORTED_WITHDRAWAL_NETWORKS,
} from "@/lib/withdrawals";
import type { DocSection } from "./types";

/**
 * Terms & Conditions — content.
 *
 * Describes the product as implemented in this repository. It deliberately promises nothing about earnings,
 * downloads, advertising revenue, payment timing or uptime, and states no fee or revenue-share rate (none is
 * defined in the code). Legal-entity facts (operator, address, governing law, venue, contact) come from
 * src/config/legal.ts and render as marked placeholders until configured. The text should be reviewed by a
 * qualified lawyer before publication.
 */
export function buildTermsSections(config: LegalConfig = LEGAL_CONFIG): DocSection[] {
  const operator = isLegalValueSet("operatorName", config) ? legalValue("operatorName", config) : "the operator of Onfile";
  const min = `$${MIN_WITHDRAWAL_USD} USD`;
  const networks = SUPPORTED_WITHDRAWAL_NETWORKS.join(", ");
  const currencies = SUPPORTED_WITHDRAWAL_CURRENCIES.join(", ");

  return [
    {
      id: "introduction",
      title: "Introduction",
      blocks: [
        {
          type: "p",
          text: `These Terms & Conditions (the "Terms") govern your use of Onfile, a Telegram Mini App operated by ${operator} ("Onfile", "we", "us"). Onfile is a platform that helps creators share files that they keep in their own private Telegram channel through links, lets other people access those files, and offers creators tools to monetize that access.`,
        },
        {
          type: "p",
          text: "Onfile is a facilitator. It does not host creators' original files; they remain in Telegram. Creators, not Onfile, decide what they share.",
        },
      ],
    },
    {
      id: "acceptance",
      title: "Acceptance of Terms",
      blocks: [
        {
          type: "p",
          text: "By opening Onfile, creating an account, connecting a channel, publishing content, or accessing content through an Onfile link, you agree to these Terms and to the Privacy & Security page. If you do not agree, do not use Onfile. You must also follow Telegram's own terms, which apply to your use of Telegram.",
        },
      ],
    },
    {
      id: "eligibility",
      title: "Eligibility",
      blocks: [
        {
          type: "ul",
          items: [
            "You must have a Telegram account in good standing and meet Telegram's minimum age requirement.",
            "You must be old enough to enter into a binding agreement where you live, or have a parent or guardian who agrees on your behalf.",
            "You must not be barred from using the service under any law that applies to you.",
          ],
        },
      ],
    },
    {
      id: "account-registration",
      title: "Account Registration",
      blocks: [
        {
          type: "p",
          text: "Onfile uses your Telegram identity to sign you in; there is no separate password. A creator account is created when you successfully connect a verified private Telegram channel. You are responsible for the activity on your Telegram account and your Onfile account. Information you give us must be accurate. Viewers who only open shared links do not need an account.",
        },
      ],
    },
    {
      id: "user-responsibilities",
      title: "User Responsibilities",
      blocks: [
        {
          type: "ul",
          items: [
            "Use Onfile lawfully and in line with these Terms and Telegram's terms.",
            "Keep your Telegram account secure.",
            "Do not interfere with the service, probe or bypass its protections (for example the access step or file passwords), or use it to harm others.",
            "Do not attempt to access another person's account, files, balances or data.",
          ],
        },
      ],
    },
    {
      id: "creator-responsibilities",
      title: "Creator Responsibilities",
      blocks: [
        { type: "p", text: "If you publish content through Onfile you are the creator and you are responsible for it. In particular you must:" },
        {
          type: "ul",
          items: [
            "Own, or have all rights and permissions needed to distribute, every file, thumbnail, title and description you share.",
            "Make sure that what you share complies with applicable law and these Terms.",
            "Describe your files honestly and keep your channel, links and access settings (such as passwords) up to date.",
            "Respond appropriately to reports and rights-holder complaints about your content, and remove content that should not be shared.",
            "Handle any password you set and any person you give access to responsibly.",
          ],
        },
      ],
    },
    {
      id: "channel-ownership",
      title: "Telegram Channel Ownership & Permissions",
      blocks: [
        {
          type: "ul",
          items: [
            "You may only connect a private channel that you own. Onfile checks this with Telegram, and does not accept channels with a public @username.",
            "To connect a channel you add the Onfile bot as an administrator. Onfile requests only the Post Messages right and no other administrator rights.",
            "You stay the owner and administrator of your channel and everything in it. You can disconnect a channel in Channel Management and remove the bot in Telegram at any time.",
            "Onfile depends on Telegram. Telegram, not Onfile, controls channels, messages, membership and file delivery inside Telegram, and Telegram may change or restrict its features.",
          ],
        },
      ],
    },
    {
      id: "uploads-and-ownership",
      title: "File Uploads and Content Ownership",
      blocks: [
        {
          type: "p",
          text: "You do not upload original files to Onfile; you post them in your own Telegram channel and give Onfile the link. As between you and Onfile, you keep all ownership of your content. Onfile does not claim ownership of your files.",
        },
        {
          type: "p",
          text: "You give Onfile a limited, non-exclusive permission to store and display the information needed to operate the service for you — links, titles, descriptions, thumbnails, your display name and photo — and to show and deliver your content through Onfile links as you configure them. This permission lasts as long as the content is published on Onfile and ends when you delete it, except for copies that remain for a short time in backups or logs.",
        },
      ],
    },
    {
      id: "copyright",
      title: "Copyright & Intellectual Property",
      blocks: [
        {
          type: "p",
          text: "Onfile's name, logo, design and software belong to Onfile or its licensors. These Terms do not give you rights to them other than to use the service.",
        },
        {
          type: "p",
          text: "Do not share content that infringes someone else's copyright, trademark or other rights. If you believe content shared through Onfile infringes your rights, use the Report button on the file or playlist page and choose Copyright, or contact us at the copyright contact below, and include enough detail to identify the content and your rights in it. We may remove or disable access to content that is reported or that we believe infringes rights, and we may suspend creators who repeatedly infringe. Onfile does not guarantee a particular response time or outcome.",
        },
      ],
    },
    {
      id: "prohibited",
      title: "Prohibited Content and Activities",
      blocks: [
        { type: "p", text: "You must not use Onfile to share, link to or promote:" },
        {
          type: "ul",
          items: [
            "Content you do not have the right to distribute, including pirated or otherwise infringing material.",
            "Malware, phishing, or anything designed to damage devices or steal information.",
            "Content that is illegal where it is shared or accessed, including content that sexually exploits or endangers minors.",
            "Content that harasses, threatens, defames or discriminates against people, or that invades their privacy.",
            "Spam, scams, deceptive or misleading content or links.",
          ],
        },
        { type: "p", text: "You must also not:" },
        {
          type: "ul",
          items: [
            "Create fake accounts, manipulate views, downloads, referrals or earnings, or otherwise abuse monetization or the wallet.",
            "Bypass or attempt to bypass access steps, passwords, rate limits or other protections.",
            "Overload, scrape, reverse engineer or attack the service.",
            "Use Onfile in a way that breaks Telegram's terms.",
          ],
        },
        { type: "p", text: "Content reported as inappropriate or NSFW may be reviewed and may be restricted or removed." },
      ],
    },
    {
      id: "access-and-delivery",
      title: "File Access and Delivery",
      blocks: [
        {
          type: "p",
          text: "A creator's file is opened through an Onfile link. The viewer completes the access step set for that file (a timed advertisement step, or a password if the creator set one), after which Onfile shows a link that opens the creator's Telegram post. Telegram delivers the file under Telegram's own rules; Onfile does not serve original files from its own servers.",
        },
        {
          type: "p",
          text: "Onfile does not guarantee that a file will be available, that a link will open on every device or Telegram client, or that a creator's channel or post will remain in place. Creators can unpublish or delete links; deleting an Onfile link does not delete the Telegram post.",
        },
      ],
    },
    {
      id: "ads-and-unlocking",
      title: "Advertisements and Unlocking",
      blocks: [
        {
          type: "p",
          text: "Files that are not password-protected show a short timed advertisement step before the file link is revealed. Password-protected files are unlocked with the password instead. Listing a price in Telegram Stars is possible in some places in the app, but Telegram Stars checkout is not available at this time and nothing is charged; paid publishing is not active.",
        },
        {
          type: "p",
          text: "Onfile does not promise that advertisements will be shown to every viewer, that any advertisement will generate revenue, or any rate of payment. The \"Advertise with Us\" form in the app only sends an enquiry; submitting it does not create a contract or guarantee a campaign.",
        },
      ],
    },
    {
      id: "earnings",
      title: "Creator Earnings",
      blocks: [
        {
          type: "p",
          text: "The Wallet shows balances in USDT: available, pending, referral and all-time amounts. Earnings are not guaranteed. Whether you earn anything, and how much, depends on factors outside Onfile's control, such as whether people open your content, advertising availability, and eligibility and monetization rules that apply to your account and may change.",
        },
        {
          type: "p",
          text: "These Terms do not set any revenue-share percentage, rate per download, or fee. Amounts shown in the app are informational until paid. Onfile may correct balances that were shown in error, and may withhold, adjust or reverse earnings that result from fraud, invalid or manipulated activity, infringement, or a breach of these Terms.",
        },
      ],
    },
    {
      id: "wallet-withdrawals",
      title: "Wallet and Withdrawals",
      blocks: [
        {
          type: "ul",
          items: [
            `Withdrawal requests are made in the Wallet tab. The currently supported currency is ${currencies}, on these networks: ${networks}. Other payment methods shown as \"coming soon\" are not available.`,
            "You provide the destination wallet address and network. You are responsible for entering them correctly. Cryptocurrency transfers to a wrong address or network are usually irreversible and may be lost.",
            "When you submit a request, the amount moves from your available balance to your pending balance and the request appears in your withdrawal history with a status (pending, processing, completed, rejected or cancelled).",
            "Onfile may review, delay, reject or cancel a request, for example for verification, security, suspected abuse or a breach of these Terms. A rejected request shows its status and, where given, a reason.",
            "The Wallet screen shows an estimated processing time. It is an estimate only, not a promise. Blockchain network conditions are outside Onfile's control.",
            "These Terms do not state a withdrawal fee. If fees or network costs apply to a payout, they will be shown in the app or be a cost of the network.",
          ],
        },
      ],
    },
    {
      id: "minimum-withdrawal",
      title: "Minimum Withdrawal Amount",
      blocks: [
        {
          type: "p",
          text: `The minimum withdrawal amount is ${min} (${MIN_WITHDRAWAL_USD} USDT). Requests below ${min} are not accepted, and your balance is not changed when a request is not accepted. Your available balance must also cover the amount you request. This minimum is enforced by Onfile's servers, not only in the app, and may be changed in the future with notice in the app or on this page.`,
        },
      ],
    },
    {
      id: "referral",
      title: "Referral Program",
      blocks: [
        {
          type: "p",
          text: "The Me tab includes a Referral Program screen that shows your referral code and link and describes a commission for referred creators. Any commission is subject to these Terms, to verification, and to the monetization rules that apply at the time. Onfile does not guarantee that a referral will be recorded or that any commission will be earned or paid, may change or end the program, and may withhold commission for self-referrals, fake accounts or other abuse.",
        },
      ],
    },
    {
      id: "suspension",
      title: "Account Suspension and Termination",
      blocks: [
        {
          type: "p",
          text: "We may suspend or restrict an account, disable links or content, withhold funds, or end access if we reasonably believe you have breached these Terms or the law, put others or the service at risk, or if required by law or by Telegram. Where reasonable we will try to say why, but we may act without notice where needed to protect users or the service.",
        },
        {
          type: "p",
          text: "You can stop using Onfile at any time by disconnecting your channels. To ask for your account to be deleted, use the contact details below; the app does not currently offer a self-service deletion button. Sections that by their nature should continue after termination, such as those on content ownership, liability and disputes, will continue.",
        },
      ],
    },
    {
      id: "availability",
      title: "Platform Availability",
      blocks: [
        {
          type: "p",
          text: "Onfile is provided on an as-available basis. We do not promise uninterrupted or error-free service. Onfile depends on Telegram and on third-party hosting, database and storage providers, and may be unavailable or change because of maintenance, outages or their decisions. We may change, limit or discontinue features, including monetization features.",
        },
      ],
    },
    {
      id: "liability",
      title: "Limitation of Liability",
      blocks: [
        {
          type: "p",
          text: "To the fullest extent permitted by law, Onfile and its operator are not liable for indirect, incidental, special, consequential or punitive damages, or for lost profits, revenue, data or goodwill, or for losses from content shared by creators, from Telegram or other third-party services, from incorrect wallet addresses or networks, or from service interruptions. To the extent liability cannot be excluded, it is limited to the amount permitted by applicable law. Nothing in these Terms limits liability that cannot be limited by law.",
        },
      ],
    },
    {
      id: "disclaimer",
      title: "Disclaimer",
      blocks: [
        {
          type: "p",
          text: "Onfile is provided \"as is\" and \"as available\" without warranties of any kind, express or implied, including merchantability, fitness for a particular purpose and non-infringement, to the extent permitted by law. Onfile does not guarantee earnings, downloads, views, advertising revenue, payment timing, or that content shared by others is lawful, accurate or safe.",
        },
      ],
    },
    {
      id: "changes",
      title: "Changes to Terms",
      blocks: [
        {
          type: "p",
          text: "We may update these Terms. The effective date at the top shows the version that applies. If you keep using Onfile after an update takes effect, you accept the updated Terms. If you do not agree to an update, stop using Onfile.",
        },
      ],
    },
    {
      id: "governing-law",
      title: "Governing Law",
      blocks: [
        {
          type: "p",
          text: `These Terms are governed by ${legalValue("governingLaw", config)}. Disputes will be handled in ${legalValue("disputeVenue", config)}. This does not remove any mandatory consumer rights you have under the law where you live.`,
        },
      ],
    },
    {
      id: "contact",
      title: "Contact Information",
      blocks: [
        {
          type: "ul",
          items: [
            `Operator: ${legalValue("operatorName", config)}`,
            `Address: ${legalValue("operatorAddress", config)}`,
            `Contact email: ${legalValue("contactEmail", config)}`,
            `Copyright complaints: ${copyrightContact(config)}`,
          ],
        },
        { type: "p", text: "Onfile does not currently offer live chat or an in-app support desk." },
      ],
    },
  ];
}
