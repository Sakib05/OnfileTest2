import { LEGAL_CONFIG, legalValue } from "@/content/legalConfig";
import type { LegalSection } from "@/content/privacy";
import { MIN_WITHDRAWAL_USD } from "@/lib/money";

/**
 * Terms & Conditions. Written against the actual product behaviour. It deliberately does NOT state commission
 * percentages, revenue guarantees, payout timelines, refund promises or payment methods beyond what the app does.
 * Implementation draft — requires legal review before publication.
 */
export function getTermsSections(): LegalSection[] {
  const contact = legalValue(LEGAL_CONFIG.contactEmail, "contact e-mail");
  return [
    {
      id: "acceptance",
      title: "1. Acceptance of Terms",
      body: [
        "By opening or using Onfile you agree to these Terms & Conditions and to the Privacy & Security page. If you do not agree, do not use Onfile.",
      ],
    },
    {
      id: "about",
      title: "2. About Onfile",
      body: [
        "Onfile is a Telegram Mini App that lets creators share files stored in their own private Telegram channels through Onfile links, with optional password protection, playlists and creator earnings tools. Onfile does not host or store creators' original files on its own application server; originals stay in the creator's Telegram channel and are delivered through Telegram. There is no public content feed or file discovery page.",
        `Operator: ${legalValue(LEGAL_CONFIG.legalEntityName, "legal entity name")}`,
      ],
    },
    {
      id: "eligibility",
      title: "3. Eligibility",
      body: [
        `You must have a Telegram account, be able to enter into a binding agreement under the laws that apply to you, and meet the minimum age of ${legalValue(LEGAL_CONFIG.minimumAge, "minimum age")} as well as Telegram's own age requirements.`,
      ],
    },
    {
      id: "accounts",
      title: "4. User Accounts",
      body: [
        "You sign in with your Telegram account; Onfile does not issue a separate password. You are responsible for all activity under your Telegram account and for keeping your login codes and Telegram passwords private. Visitors who only open a shared link do not need an Onfile account.",
      ],
    },
    {
      id: "creator-accounts",
      title: "5. Creator Accounts",
      body: [
        "A creator account is created after you connect and verify a private Telegram channel. Your Display Name and profile picture can be edited in Onfile. Your Telegram username is read-only and follows your Telegram account. Creators must provide accurate account information.",
      ],
    },
    {
      id: "channel",
      title: "6. Telegram Channel Connection",
      body: [
        "To publish, you must connect a private Telegram channel that you administer and add the Onfile bot as an administrator with the \"Post Messages\" right. Onfile verifies this with Telegram. Public channels are not supported. If you remove the bot or lose control of the channel, Onfile features that depend on it may stop working. You may disconnect a channel at any time from Channel Management.",
      ],
    },
    {
      id: "responsibilities",
      title: "7. Creator Responsibilities",
      body: [
        "Creators are responsible for:",
        "• having the legal right to distribute the content they upload and share;",
        "• ensuring shared content does not violate copyright or other rights;",
        "• maintaining control over their connected Telegram channels;",
        "• providing accurate account information; and",
        "• following applicable laws and Onfile's policies.",
      ],
    },
    {
      id: "upload",
      title: "8. File Upload and Distribution",
      body: [
        "Creators upload originals to their own Telegram channel and publish a link to the post through Onfile. Onfile records details about the file and delivers access through Telegram; it does not review content before it is shared and does not take ownership of it. Deleting a file in Onfile does not delete the Telegram post. Creators grant Onfile only the permission needed to operate the service for the content they publish.",
      ],
    },
    {
      id: "copyright",
      title: "9. Copyright and Intellectual Property",
      body: [
        "Content remains the property of its owners. You must not publish content that you do not have the right to distribute. Onfile's name, logo and software belong to Onfile and its licensors. Thumbnails and profile pictures you upload must also be yours to use.",
      ],
    },
    {
      id: "prohibited",
      title: "10. Prohibited Content",
      body: [
        "You must not use Onfile to distribute:",
        "• illegal content or content that facilitates illegal activity;",
        "• stolen, pirated or otherwise infringing content;",
        "• malware or anything designed to harm devices or accounts;",
        "• spam, scams or deliberately misleading content; or",
        "• other content that violates the law, third-party rights or these Terms.",
      ],
    },
    {
      id: "sharing",
      title: "11. File Sharing and Access",
      body: [
        "Files are reachable only through links the creator shares, and only while published. Anyone who has a link may be able to pass it on. Onfile can't prevent a person who legitimately received content from copying or redistributing it. QR codes carry the same link and are subject to the same access rules.",
      ],
    },
    {
      id: "playlists",
      title: "12. Playlists",
      body: [
        "Creators can group files into playlists and share them with a public link while the playlist is public. Making a playlist private stops its link from working. Each file inside a playlist keeps its own access rules.",
      ],
    },
    {
      id: "passwords",
      title: "13. Password-Protected Content",
      body: [
        "Creators may protect files and playlists with a password. Passwords are stored as salted hashes and cannot be recovered; creators can set a new one. Creators are responsible for choosing strong passwords and sharing them only with the intended audience. Onfile does not guarantee that protected content cannot be accessed by someone who is given or guesses the password.",
      ],
    },
    {
      id: "ads",
      title: "14. Advertisements",
      body: [
        "Onfile may show an advertisement step before access is granted on files that are not password-protected. Creators agree that their shared files may be presented with such a step. Onfile does not promise the content, number or frequency of advertisements.",
      ],
    },
    {
      id: "earnings",
      title: "15. Creator Earnings",
      body: [
        "Creator earnings are shown in the Wallet as recorded by Onfile. Onfile does not guarantee any level of earnings, advertising revenue or traffic, and these Terms do not set a commission percentage or rate. Earnings may be adjusted or withheld where content violates these Terms, where activity is fraudulent or abusive, or where records were created in error.",
      ],
    },
    {
      id: "withdrawals",
      title: "16. Withdrawals",
      body: [
        "Creators can request a withdrawal from the Wallet by entering an amount, a supported network and a wallet address. A request is recorded as pending and appears in the withdrawal history, and is subject to review. Onfile does not guarantee a processing time. You are responsible for entering the correct wallet address and network: funds sent to a wrong address may be lost and cannot be recovered by Onfile.",
      ],
    },
    {
      id: "minimum",
      title: "17. Minimum Withdrawal Amount",
      body: [
        `The minimum withdrawal amount is $${MIN_WITHDRAWAL_USD} USD (${MIN_WITHDRAWAL_USD} USDT at the app's 1:1 display rate). Requests below this amount are rejected, and no balance is deducted for a rejected request. Requests also cannot exceed your available balance.`,
      ],
    },
    {
      id: "processing",
      title: "18. Payment Processing",
      body: [
        "Withdrawals are requested in USDT on the networks offered in the Wallet at the time of the request. Onfile may add or remove payout options. Third-party networks and wallets are outside Onfile's control, and network fees, delays or errors on those networks are not Onfile's responsibility.",
      ],
    },
    {
      id: "refunds",
      title: "19. Refunds and Payment Disputes",
      body: [
        "These Terms do not promise refunds. Selling content for Telegram Stars is not currently active in Onfile. If you believe a balance, transaction or withdrawal record is wrong, contact us with the details and we will review it.",
        `Contact: ${contact}`,
      ],
    },
    {
      id: "reports",
      title: "20. Copyright Reports",
      body: [
        "Anyone can report a file or playlist from its page, choosing a reason such as copyright or unauthorized content and optionally adding details. Reports are recorded for review. Onfile does not promise automatic removal or a particular review timeline, and may act on a report at its discretion, including by unpublishing content or restricting an account.",
      ],
    },
    {
      id: "suspension",
      title: "21. Account Suspension and Termination",
      body: [
        "Onfile may suspend or terminate access, unpublish content or withhold earnings if you violate these Terms or the law, abuse the service, or put others at risk. You may stop using Onfile at any time by disconnecting your channels and ceasing to use the app; to request deletion of your data see the Privacy & Security page.",
      ],
    },
    {
      id: "availability",
      title: "22. Service Availability",
      body: [
        "Onfile is provided on an \"as is\" and \"as available\" basis. It may be unavailable, changed or discontinued from time to time, and it depends on Telegram being available. Onfile does not guarantee uninterrupted or error-free operation.",
      ],
    },
    {
      id: "third-party",
      title: "23. Third-Party Services",
      body: [
        "Onfile relies on Telegram, an image storage service for thumbnails and profile pictures, and hosting and database providers. Their own terms and policies apply to their services, and Onfile is not responsible for their availability or conduct.",
      ],
    },
    {
      id: "liability",
      title: "24. Limitation of Liability",
      body: [
        "To the maximum extent permitted by law, Onfile is not liable for indirect, incidental or consequential damages, loss of profits, revenue, data or goodwill, or for content shared by creators or third parties. Nothing in these Terms limits liability that cannot be limited by law.",
        `Governing law and jurisdiction: ${legalValue(LEGAL_CONFIG.governingLaw, "governing law and jurisdiction")}`,
      ],
    },
    {
      id: "changes",
      title: "25. Changes to Terms",
      body: ["These Terms may be updated from time to time. The \"Last updated\" date shows the latest version. Continuing to use Onfile after a change means you accept the updated Terms."],
    },
    {
      id: "contact",
      title: "26. Contact Information",
      body: [
        `Operator: ${legalValue(LEGAL_CONFIG.legalEntityName, "legal entity name")}`,
        `Contact e-mail: ${contact}`,
        `Address: ${legalValue(LEGAL_CONFIG.contactAddress, "postal address")}`,
      ],
    },
  ];
}
