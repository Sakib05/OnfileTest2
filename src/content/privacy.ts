import { LEGAL_CONFIG, legalValue } from "@/content/legalConfig";
import { DISPLAY_NAME_MAX, PROFILE_IMAGE_MAX_LABEL } from "@/lib/profile";
import { MIN_WITHDRAWAL_USD } from "@/lib/money";

export interface LegalSection {
  id: string;
  title: string;
  /** Paragraphs. A line starting with "• " is rendered as a list item. */
  body: string[];
}

/**
 * Privacy Policy + Security overview. Written against the actual implementation (see src/db/schema.ts, src/lib/auth.ts,
 * src/lib/thumbnails/*, src/lib/profileImage.ts). Implementation draft — requires legal review before publication.
 */
export function getPrivacySections(): LegalSection[] {
  const contact = legalValue(LEGAL_CONFIG.contactEmail, "privacy contact e-mail");
  return [
    {
      id: "intro",
      title: "1. Introduction",
      body: [
        "Onfile is a Telegram Mini App that helps creators share files that they keep in their own private Telegram channels. This page explains what information Onfile handles, why, and what choices you have.",
        "Onfile does not host or store creators' original uploaded files on its own application server. Original files remain in creators' private Telegram channels and are delivered using Telegram's infrastructure.",
      ],
    },
    {
      id: "collect",
      title: "2. Information We Collect",
      body: [
        "Onfile keeps different kinds of information separate:",
        "• Account information: your Telegram identity details and profile settings.",
        "• Channel and file records: details about your connected channel and the files you publish (not the files themselves).",
        "• Thumbnails and profile pictures: small images kept in a separate image storage service.",
        "• Payment and withdrawal records: balances and withdrawal requests.",
        "• Technical data: session, preference and usage data needed to run the service.",
        "• Reports: information submitted when someone reports content.",
      ],
    },
    {
      id: "telegram",
      title: "3. Telegram Account Information",
      body: [
        "You sign in through Telegram. When you open Onfile, Telegram provides signed launch data, which Onfile verifies on the server. From it Onfile stores your Telegram user ID, username, first and last name, language code and the link to your Telegram profile photo. The raw launch data is verified and not kept.",
        "Your Telegram username always follows your Telegram account and cannot be changed in Onfile. Onfile never receives your Telegram password or login codes.",
      ],
    },
    {
      id: "profile",
      title: "4. Creator Profile Information",
      body: [
        `Your Display Name (up to ${DISPLAY_NAME_MAX} characters) and an optional profile picture you upload are stored with your account and may be shown to people who open your links (for example, on a file or playlist page).`,
        `Uploaded profile pictures (JPG, PNG or WebP, up to ${PROFILE_IMAGE_MAX_LABEL}) are validated, cropped to a square and re-encoded; embedded metadata is removed. The image is kept in the same external image storage used for thumbnails and only a storage key is saved with your account. If you never upload one, your Telegram profile photo (if any) or an initial-letter placeholder is shown, as before.`,
        "Other profile data includes your theme and language preferences and a referral code.",
      ],
    },
    {
      id: "content",
      title: "5. Uploaded Content and Telegram Storage",
      body: [
        "Creators upload original files to their own private Telegram channel using Telegram. Onfile does not download, copy or store those files. For each published file Onfile stores a record: title, description, file type and size information, the link to the Telegram post, a public Onfile link, access settings (such as a password, stored only as a salted hash), counters and timestamps.",
        "Thumbnails you add are stored in a separate image storage service (currently DBByte) and are delivered from its public CDN address. Thumbnail images are not private. Deleting a file from Onfile removes the Onfile record and its thumbnail; it never deletes anything from your Telegram channel.",
        "Channel records contain the channel's Telegram ID, name, optional username and its connection status. Onfile's bot is added to your channel as an administrator with the \"Post Messages\" right only.",
      ],
    },
    {
      id: "access",
      title: "6. File Access and Delivery",
      body: [
        "When someone opens a creator's link, Onfile's server checks whether the file or playlist is published and applies its access rules (advertisement step or password). Access is granted only after the server's answer. Delivery then happens through Telegram, which leads the visitor to the original post. Telegram's own privacy policy applies to what happens inside Telegram.",
        "Visitors are not required to create an Onfile account to open a link. Onfile records usage counters such as views and downloads for the creator's statistics, and applies rate limiting to protect against abuse.",
      ],
    },
    {
      id: "payments",
      title: "7. Payment and Withdrawal Information",
      body: [
        `Onfile keeps your balance, pending balance, referral earnings, transaction history and withdrawal requests. A withdrawal request stores the amount, currency, network, destination wallet address and status. Requests must be at least $${MIN_WITHDRAWAL_USD} USD.`,
        "This information is shown only to you in your Wallet and is used to process and audit withdrawals. Onfile does not collect card numbers or bank details through the app.",
      ],
    },
    {
      id: "technical",
      title: "8. Cookies, Local Storage, and Technical Data",
      body: [
        "• Session cookie (onfile_session): an HTTP-only cookie holding a random token. Only a hash of the token is stored on the server, together with the browser user-agent and the last-used time. It lasts up to 30 days or until you sign out.",
        "• Setup cookie (onfile_setup): a short-lived signed cookie used while a new account is being connected to a channel.",
        "• Local storage on your device: your light/dark preference, whether onboarding was completed, a temporary marker during channel connection and your device-local Saved Items.",
        "• Technical data: request information such as IP address may be processed in order to rate-limit requests and keep the service secure. Reports store the reporter's IP address.",
      ],
    },
    {
      id: "use",
      title: "9. How We Use Information",
      body: [
        "• To sign you in and keep your account secure.",
        "• To verify your channel and publish, protect and deliver links.",
        "• To show profile details on your pages and screens.",
        "• To record earnings and handle withdrawal requests.",
        "• To send in-app notifications about your account activity.",
        "• To prevent abuse, review reports and keep the service working.",
        "Onfile does not sell personal information.",
      ],
    },
    {
      id: "sharing",
      title: "10. Data Sharing and Third-Party Services",
      body: [
        "Onfile relies on third-party services to operate:",
        "• Telegram: sign-in, your channel, the bot and file delivery.",
        "• An image storage service (DBByte) for thumbnails and profile pictures.",
        "• Hosting and managed database providers that run the application and store its data.",
        "Information is shared with these providers only as needed to provide the service. Creators' display name, profile picture and thumbnails can be seen by anyone who has a link to their content. Information may also be disclosed where required by law.",
      ],
    },
    {
      id: "retention",
      title: "11. Data Retention",
      body: [
        "Account, channel, file and wallet records are kept while your account is active. Sign-in sessions expire after 30 days. Thumbnails you remove or replace, and unused draft thumbnails older than 24 hours, are deleted from image storage (failed deletions are retried later). Replaced or removed profile pictures are deleted in the same way. Financial records may be retained as needed for audit and legal reasons.",
        "A complete retention schedule has not yet been defined for every data type. This needs to be confirmed by the operator before publication.",
      ],
    },
    {
      id: "deletion",
      title: "12. Account and Data Deletion",
      body: [
        "You can already remove many things yourself in the app: delete files, remove thumbnails, remove your uploaded profile picture, disconnect channels and edit your Display Name. Onfile never deletes content from your Telegram channel, so remove channel posts in Telegram.",
        `A self-service \"delete my account\" feature is not currently available in the app. To request deletion of your account data, contact: ${contact}.`,
      ],
    },
    {
      id: "rights",
      title: "13. User Rights",
      body: [
        "Depending on where you live, you may have rights to access, correct, delete or export your personal data, or to object to certain processing. You can correct your Display Name and picture in Edit Profile. For other requests, contact us using the details below. Applicable rights depend on your jurisdiction and have not been legally reviewed yet.",
      ],
    },
    {
      id: "children",
      title: "14. Children's Privacy",
      body: [
        `Onfile is not directed at children. Minimum age: ${legalValue(LEGAL_CONFIG.minimumAge, "minimum age")} (Telegram's own age requirements also apply). If you believe a child has provided personal information to Onfile, contact us so it can be removed.`,
      ],
    },
    {
      id: "updates",
      title: "15. Policy Updates",
      body: ["This policy may change as Onfile changes. The \"Last updated\" date above shows the latest version. Continued use after an update means you accept the updated policy."],
    },
    {
      id: "contact",
      title: "16. Contact Information",
      body: [
        `Operator: ${legalValue(LEGAL_CONFIG.legalEntityName, "legal entity name")}`,
        `Contact e-mail: ${contact}`,
        `Address: ${legalValue(LEGAL_CONFIG.contactAddress, "postal address")}`,
      ],
    },
  ];
}

/** Security overview. Describes what is actually implemented; makes no certification or encryption claims. */
export function getSecuritySections(): LegalSection[] {
  return [
    {
      id: "sec-intro",
      title: "How Onfile protects your account and content",
      body: [
        "This section describes the protections that exist in Onfile today. No system is perfectly secure, and Onfile does not claim security certifications. Onfile does not offer end-to-end encryption of its own, and it cannot prevent every unauthorized copy or redistribution of content once a person has legitimately received it.",
      ],
    },
    {
      id: "sec-auth",
      title: "Telegram-based authentication",
      body: [
        "You sign in with your Telegram identity. Onfile has no separate password for you to lose or reuse. After sign-in the server issues a random session token in an HTTP-only cookie and stores only its hash, so a database read alone can't be replayed as a login.",
      ],
    },
    {
      id: "sec-webapp",
      title: "Handling of Telegram WebApp authentication data",
      body: [
        "The signed launch data from Telegram is verified on the server using Telegram's official method (an HMAC signed with the bot token), and rejected if it is invalid, malformed or too old. Your identity is never taken from anything the browser merely claims.",
      ],
    },
    {
      id: "sec-channel",
      title: "Channel ownership and permission verification",
      body: [
        "A channel is connected only after the server checks, live with Telegram, that you administer it, that it is private, and that the Onfile bot is an administrator with the required right. A channel can be actively connected to only one creator account at a time. Posts you publish are verified to exist in your own connected channel.",
      ],
    },
    {
      id: "sec-access",
      title: "Access control for private files and playlists",
      body: [
        "Files and playlists are reachable only through their unguessable links, and only while published. Unpublished, private and missing items give the same answer, so they can't be probed. The server decides access; the page never reveals the Telegram link before the server approves.",
      ],
    },
    {
      id: "sec-password",
      title: "Password protection",
      body: [
        "Files and playlists can be password-protected. Passwords are stored as salted scrypt hashes, compared in constant time, and unlock attempts are rate-limited. QR codes carry the same links and go through the same checks.",
      ],
    },
    {
      id: "sec-api",
      title: "Secure API validation",
      body: [
        "State-changing requests require a valid session and are checked for same-origin use. The server validates all input again regardless of any checks in the app, and always takes your identity from your session, never from a user ID sent by the client.",
      ],
    },
    {
      id: "sec-image",
      title: "Profile image upload validation",
      body: [
        `Uploads are limited to JPG, PNG and WebP up to ${PROFILE_IMAGE_MAX_LABEL}. The server checks the file's real format (not its name), rejects animated or corrupt images, limits image dimensions, then decodes and re-encodes the picture, which strips embedded metadata.`,
      ],
    },
    {
      id: "sec-account",
      title: "Protection against unauthorized account changes",
      body: [
        "Profile edits can only be made by the signed-in owner. The profile endpoint accepts a Display Name and preferences only; your Telegram ID and Telegram username cannot be changed through it, and an attempt to change the username is refused.",
      ],
    },
    {
      id: "sec-finance",
      title: "Protection of creator financial information",
      body: [
        `Wallet data is visible only to its owner. Withdrawal rules are enforced on the server: the amount must be at least $${MIN_WITHDRAWAL_USD}, it can't exceed your available balance, and the balance change and the request are saved together in one database transaction so an invalid request deducts nothing. Identical repeat requests are blocked.`,
      ],
    },
    {
      id: "sec-reporting",
      title: "Reporting and copyright-related safety",
      body: [
        "Anyone can report a file or playlist from its page. Reports are recorded for review. Onfile does not promise automatic removal or a particular review time.",
      ],
    },
    {
      id: "sec-user",
      title: "What you can do",
      body: [
        "• Never share Telegram login codes, passwords or Two-Step Verification passwords with anyone, including people claiming to represent Onfile.",
        "• Turn on Two-Step Verification in Telegram.",
        "• Only connect channels you control and keep the channel's admin list short.",
        "• Use a strong, unique password for protected files and playlists, and share it only with the intended audience.",
        "• Double-check wallet addresses and networks before requesting a withdrawal.",
      ],
    },
  ];
}
