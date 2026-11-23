import { THUMBNAIL_MAX_LABEL } from "@/lib/publishing/constants";
import {
  MIN_WITHDRAWAL_USD,
  SUPPORTED_WITHDRAWAL_CURRENCIES,
  SUPPORTED_WITHDRAWAL_NETWORKS,
} from "@/lib/withdrawals";
import { AD_SECONDS } from "@/lib/download";

/**
 * FAQ & Help content — single source of truth.
 *
 * Accuracy rules for editing this file: describe only what the code does today. Do not add earnings,
 * revenue-rate, payment-timing, file-format or support-channel promises. Features that are NOT in the app
 * (and therefore have no entry here): end cards / recommendations, a self-service account-deletion button, a live
 * support channel, PayPal withdrawals, Telegram Stars checkout, paid publishing.
 */

export type FaqCategoryId =
  | "getting-started"
  | "account"
  | "channel"
  | "files"
  | "sharing"
  | "delivery"
  | "playlists"
  | "qr"
  | "ads"
  | "wallet"
  | "withdrawals"
  | "referrals"
  | "settings"
  | "privacy"
  | "troubleshooting"
  | "support";

export interface FaqCategory {
  id: FaqCategoryId;
  title: string;
  description: string;
}

export interface FaqEntry {
  id: string;
  category: FaqCategoryId;
  question: string;
  /** Plain-text paragraphs. */
  answer: string[];
  /** Optional numbered steps shown after the answer. */
  steps?: string[];
  /** Extra search terms (synonyms) that are not in the visible text. */
  keywords?: string[];
}

const NETWORKS = SUPPORTED_WITHDRAWAL_NETWORKS.join(", ");
const CURRENCY = SUPPORTED_WITHDRAWAL_CURRENCIES.join(", ");
const MIN = `$${MIN_WITHDRAWAL_USD} USD`;

export const FAQ_CATEGORIES: FaqCategory[] = [
  { id: "getting-started", title: "Getting Started", description: "What Onfile is and how it works" },
  { id: "account", title: "Account & Telegram Login", description: "Signing in and your account" },
  { id: "channel", title: "Channel Connection", description: "Connect your private Telegram channel" },
  { id: "files", title: "Files & Publishing", description: "Publish and manage your files" },
  { id: "sharing", title: "Sharing & Links", description: "Share files with a link" },
  { id: "delivery", title: "Getting a File", description: "What visitors see when they open a link" },
  { id: "playlists", title: "Playlists", description: "Group files into ordered playlists" },
  { id: "qr", title: "QR Codes", description: "Share a link as a QR code" },
  { id: "ads", title: "Advertisements & Unlocking", description: "The access step before a file" },
  { id: "wallet", title: "Wallet & Earnings", description: "Balances and transactions" },
  { id: "withdrawals", title: "Withdrawals", description: `Minimum ${MIN}, networks, statuses` },
  { id: "referrals", title: "Referral Program", description: "Your referral code and link" },
  { id: "settings", title: "Profile & Settings", description: "Name, username, theme, notifications" },
  { id: "privacy", title: "Privacy & Security", description: "How your data and files are handled" },
  { id: "troubleshooting", title: "Troubleshooting", description: "Fix common problems" },
  { id: "support", title: "Restrictions & Support", description: "Reports, restrictions and contact" },
];

export const FAQ_ENTRIES: FaqEntry[] = [
  // ── Getting started ────────────────────────────────────────────────────────────
  {
    id: "what-is-onfile",
    category: "getting-started",
    question: "What is Onfile?",
    answer: [
      "Onfile is a Telegram Mini App for creators. You keep your files in your own private Telegram channel, and Onfile gives each file a link you can share. People who open the link complete a short access step and are then taken to your post in Telegram.",
      "Onfile also gives creators a library, playlists, QR codes, a wallet and a referral screen.",
    ],
    keywords: ["about", "overview", "introduction"],
  },
  {
    id: "how-it-works",
    category: "getting-started",
    question: "How does Onfile work, step by step?",
    answer: ["The typical creator journey:"],
    steps: [
      "Open Onfile in Telegram and connect your private Telegram channel (you add the Onfile bot as an administrator).",
      "Post your file in your own channel, using Telegram as usual.",
      "In Onfile, go to Create and paste the link to that post. Onfile checks that the post exists in your connected channel.",
      "Add a title, description, category and, if you want, a thumbnail and a password. Then publish.",
      "Share the Onfile link (or QR code). Visitors open it, complete the access step, and open your post in Telegram.",
    ],
    keywords: ["tutorial", "guide", "start"],
  },
  {
    id: "tabs",
    category: "getting-started",
    question: "What do the tabs at the bottom do?",
    answer: [
      "Home shows your balance, a performance chart and the notification bell. Files is your library of files and playlists. Create is where you publish a new file. Wallet shows balances, transactions and withdrawals. Me holds your profile, referral program, channel management, settings, FAQ & Help, Privacy & Security, and Terms & Conditions.",
    ],
  },
  {
    id: "viewer-account",
    category: "getting-started",
    question: "Do people who open my link need an Onfile account?",
    answer: [
      "No. Anyone with the link can open the file page. They do not have to sign up. They need Telegram to open the final post, and Telegram's own rules decide whether they can view it.",
    ],
    keywords: ["visitor", "viewer", "download"],
  },
  {
    id: "no-storage",
    category: "getting-started",
    question: "Does Onfile store my files?",
    answer: [
      "No. Your original files stay in your private Telegram channel and are stored by Telegram. Onfile stores a link to the post, the details you type (title, description and so on), and, if you add one, a thumbnail image. Deleting a file in Onfile does not delete your Telegram post.",
    ],
    keywords: ["storage", "servers", "upload"],
  },
  {
    id: "dashboard",
    category: "getting-started",
    question: "What is shown on the Home tab and the notification bell?",
    answer: [
      "Home shows your available balance, pending balance and total earned, plus a chart of views, downloads and earnings for a chosen period. The bell lists notifications generated by real events on your account: a channel connected, a connection that failed or was disconnected, the bot losing admin access, a file published, and a withdrawal requested.",
    ],
    keywords: ["notifications", "chart", "analytics", "dashboard"],
  },
  {
    id: "no-channel",
    category: "getting-started",
    question: "Can I use Onfile without connecting a channel?",
    answer: [
      "You can view the introduction screens, but creator features need a verified private channel first: publishing files, playlists and share links. Your account is created when you finish connecting a channel.",
    ],
  },
  {
    id: "supported-features-note",
    category: "getting-started",
    question: "Which features are not available yet?",
    answer: [
      "Telegram Stars payments and paid publishing are not active: a price cannot gate access, and nothing is charged. PayPal withdrawals are shown as \"coming soon\". There is no self-service account-deletion button and no live chat. This help center describes only what the app does today.",
    ],
    keywords: ["stars", "paypal", "coming soon", "paid"],
  },

  // ── Account & login ────────────────────────────────────────────────────────────
  {
    id: "login",
    category: "account",
    question: "How do I sign in?",
    answer: [
      "You sign in with Telegram — there is no separate password or email login. When you open Onfile from Telegram, Telegram sends signed launch data and the server verifies it. Always open Onfile from inside Telegram (from the bot or your saved link).",
    ],
    keywords: ["log in", "login", "password", "authentication"],
  },
  {
    id: "what-we-get-from-telegram",
    category: "account",
    question: "What information does Onfile get from Telegram?",
    answer: [
      "Your Telegram user ID, username, first and last name, the link to your profile photo, and your language code. Onfile does not receive your phone number, password or private chats. See Privacy & Security for details.",
    ],
  },
  {
    id: "account-creation",
    category: "account",
    question: "When is my account created?",
    answer: [
      "Your creator account is created when you successfully connect and verify your first private channel. If you stop before that, no account is created.",
    ],
  },
  {
    id: "delete-account",
    category: "account",
    question: "How do I delete my account?",
    answer: [
      "There is no self-service delete-account button in the app yet. You can delete individual files and playlists, and disconnect your channel. To ask for your account or data to be deleted, use the contact details in Privacy & Security once they are published. Content in your Telegram channel is yours and is not removed by Onfile.",
    ],
    keywords: ["remove data", "erase", "close account"],
  },

  // ── Channel connection ─────────────────────────────────────────────────────────
  {
    id: "connect-why",
    category: "channel",
    question: "Why do I need to connect my Telegram channel?",
    answer: [
      "Onfile needs a verified connection to your channel so it can confirm you are the creator, check that the posts you publish really come from your channel, and link people to those posts. Without it Onfile cannot connect a file to its creator.",
    ],
  },
  {
    id: "connect-steps",
    category: "channel",
    question: "How do I connect my channel?",
    answer: ["On the Connect screen:"],
    steps: [
      "Tap Connect. If your Telegram app supports it, Telegram's own channel picker opens inside Onfile; choose your private channel and approve adding the Onfile bot as an administrator.",
      "If your Telegram app cannot open the picker, Onfile shows a Connect channel via bot button. It opens the Onfile bot chat: tap Start if shown, tap Select channel to connect, choose your private channel, then return to Onfile.",
      "Tap Verify in Onfile. Onfile re-checks with Telegram that you own the channel and that the bot is an administrator.",
      "Once verified you will see a confirmation and land on your dashboard.",
    ],
    keywords: ["setup", "add bot", "admin"],
  },
  {
    id: "connect-manual",
    category: "channel",
    question: "What is Manual Connect?",
    answer: [
      "Manual Connect works on any Telegram version: you add the Onfile bot as an administrator from your channel's settings and paste the channel's private invite link into Onfile. It ends with the same verification as the other method.",
    ],
  },
  {
    id: "connect-private-only",
    category: "channel",
    question: "Why are only private channels supported?",
    answer: [
      "Onfile is built around private channels so that access to your content stays under your control. Every connection attempt is checked on the server, and a channel with a public @username is rejected, even if the bot is already an administrator there.",
    ],
    keywords: ["public channel", "username"],
  },
  {
    id: "connect-permissions",
    category: "channel",
    question: "What permissions does the Onfile bot need?",
    answer: [
      "Administrator status limited to Post Messages. Onfile does not request the other administrator rights (changing channel info, deleting messages, inviting or removing members, adding admins, managing video chats, stories). To check a post you submit, the bot asks Telegram to copy it silently into your private chat with the bot and then deletes the copy; nothing is posted to your channel.",
    ],
    keywords: ["admin rights", "post messages", "bot"],
  },
  {
    id: "connect-disconnect",
    category: "channel",
    question: "Can I disconnect my channel?",
    answer: [
      "Yes. Go to Me › Channel Management and disconnect it. Onfile then tries to remove the bot from the channel. You can also remove the bot yourself in Telegram. Disconnecting does not delete your files or posts.",
    ],
  },
  {
    id: "connect-failed",
    category: "channel",
    question: "My channel connection failed. What should I check?",
    answer: ["The error message tells you what is wrong. The usual causes are:"],
    steps: [
      "The channel is public (has a @username). Use a private channel instead.",
      "The Onfile bot is not yet an administrator of the channel.",
      "The bot does not have the Post Messages permission.",
      "You are not the owner of the channel.",
    ],
    keywords: ["error", "verify", "failed"],
  },

  // ── Files & publishing ─────────────────────────────────────────────────────────
  {
    id: "publish-steps",
    category: "files",
    question: "How do I publish a file?",
    answer: ["Use the Create tab. It has four steps: Link, Details, Monetization and Publish."],
    steps: [
      "Post your file in your connected private channel in Telegram.",
      "Link: copy the Telegram post link and paste it into Onfile, then tap Verify & Continue.",
      "Details: add a title and description, choose a category and file type, add a thumbnail if you like, and optionally set a password.",
      "Monetization: choose free access (paid access is not available yet).",
      "Publish: review the preview, then tap Publish.",
    ],
    keywords: ["upload", "create", "new post"],
  },
  {
    id: "upload-where",
    category: "files",
    question: "Do I upload the file to Onfile?",
    answer: [
      "No. You post it in your own Telegram channel and give Onfile the post link. Because the file stays in Telegram, Telegram's own file-size and format rules apply. Onfile lets you label the file as video, audio, document, image, archive or other.",
    ],
    keywords: ["formats", "file types", "size limit"],
  },
  {
    id: "post-verification",
    category: "files",
    question: "What does \"Verifying your post\" check?",
    answer: [
      "That the link points to a post in your connected channel and that the post really exists. For this the bot asks Telegram to copy the post into your private chat with the bot, then deletes the copy. You must have opened the Onfile bot chat and pressed Start at least once.",
    ],
  },
  {
    id: "thumbnail",
    category: "files",
    question: "Can I add a thumbnail? What are the limits?",
    answer: [
      `Yes. Thumbnails can be JPEG, PNG or WebP images, up to ${THUMBNAIL_MAX_LABEL}. They are stored with Onfile's image storage provider and shown on your file page and in your library. Thumbnails are delivered from a public address, so avoid sensitive images.`,
    ],
    keywords: ["image", "cover", "picture"],
  },
  {
    id: "manage-files",
    category: "files",
    question: "How do I manage my files?",
    answer: [
      "Open the Files tab and tap the ⋮ menu on a file. You can edit details (including the thumbnail), manage which playlists the file is in, share it (copy link or QR code), view file details, or delete it.",
    ],
    keywords: ["edit", "library", "change thumbnail"],
  },
  {
    id: "delete-file",
    category: "files",
    question: "What happens when I delete a file?",
    answer: [
      "The file is removed from your Onfile library, its Onfile link stops working and Onfile's thumbnail copy is removed. The post in your Telegram channel is not touched.",
    ],
  },
  {
    id: "drafts",
    category: "files",
    question: "Can I save a draft?",
    answer: [
      "What you type in the Create flow is remembered temporarily on your device, so you can come back to it. If you pick paid content (which is not available yet), the only option is Save as Unpublished Draft. A file only has a working public link after it is published.",
    ],
  },
  {
    id: "password",
    category: "files",
    question: "Can I protect a file with a password?",
    answer: [
      "Yes. Set a password in the Details step. Visitors must enter it to get the file. Share the password only with the people you intend. Onfile stores the password as a protected hash, so it cannot show you the password later.",
    ],
  },

  // ── Sharing ────────────────────────────────────────────────────────────────────
  {
    id: "share-file",
    category: "sharing",
    question: "How do I share a file?",
    answer: ["After publishing:"],
    steps: [
      "Go to Files and tap ⋮ on the file.",
      "Choose Share.",
      "Copy the link, or show the QR code.",
      "Send it anywhere: Telegram chats, other apps or social media.",
    ],
    keywords: ["link", "copy link"],
  },
  {
    id: "who-can-open",
    category: "sharing",
    question: "Who can open my link?",
    answer: [
      "Anyone who has it. The page shows the title, description, type, size, thumbnail, counts and your display name and photo. Password-protected files need the password to get the file. Unpublished files and drafts cannot be opened.",
    ],
  },
  {
    id: "save-items",
    category: "sharing",
    question: "What does Save do on a file page?",
    answer: [
      "Save adds the file or playlist to a list on your device only, so you can find it again. It is not tied to an account; it will not appear on another device or after clearing the app's browser data.",
    ],
    keywords: ["bookmark", "saved items"],
  },
  {
    id: "report-link",
    category: "sharing",
    question: "How do I report a file?",
    answer: [
      "Tap the flag icon on the file or playlist page and choose a reason: copyright, NSFW, malware, broken link, spam, inappropriate or other, with optional details. You do not need an account. Reports are stored for review; Onfile does not guarantee a response time or outcome.",
    ],
    keywords: ["abuse", "copyright", "dmca", "flag"],
  },

  // ── Delivery ───────────────────────────────────────────────────────────────────
  {
    id: "get-file-steps",
    category: "delivery",
    question: "How do I get a file from a link?",
    answer: ["On the file page:"],
    steps: [
      `Tap Get File. For files without a password a short timed advertisement step (${AD_SECONDS} seconds) runs.`,
      "When it finishes, tap Get File again.",
      "Tap Open in Telegram to open the creator's post in Telegram.",
      "Download or view the file in Telegram.",
    ],
    keywords: ["download", "open", "receive"],
  },
  {
    id: "password-file",
    category: "delivery",
    question: "The file asks for a password. What do I do?",
    answer: [
      "Ask the creator for the password and enter it. Password-protected files skip the timed advertisement step. Too many wrong attempts in a short time are temporarily blocked.",
    ],
  },
  {
    id: "telegram-access",
    category: "delivery",
    question: "Why can't I open the Telegram post?",
    answer: [
      "Onfile reveals the link to the creator's post, and Telegram then decides who can open it. Posts live in the creator's private channel, so Telegram's own access rules apply. If Telegram shows an error, contact the creator. Onfile cannot override Telegram's access rules.",
    ],
    keywords: ["private channel", "join", "link not working"],
  },

  // ── Playlists ──────────────────────────────────────────────────────────────────
  {
    id: "playlist-what",
    category: "playlists",
    question: "What is a playlist?",
    answer: [
      "A playlist is an ordered group of your files, useful for series, courses or collections. The same file can be in several playlists. Deleting a playlist does not delete its files.",
    ],
    keywords: ["course", "series", "collection", "lesson"],
  },
  {
    id: "playlist-create",
    category: "playlists",
    question: "How do I create and manage a playlist?",
    answer: [
      "You create a playlist while publishing a file: in the Details step, use the Playlist field and choose New Playlist. Playlists then appear in the Files tab. On the playlist page you can add files, reorder them, preview the public page and share. The ⋮ menu has: Edit details, Make private / Make public, Monetization settings, Share settings, Duplicate playlist and Delete playlist.",
    ],
  },
  {
    id: "playlist-share",
    category: "playlists",
    question: "How do I share a playlist?",
    answer: [
      "Open the playlist and choose Share. You get a public link, a copy button and a QR code. Visitors see the selected file on top and the playlist's files below, and can move through them in order. A playlist that is private or not shared cannot be opened.",
    ],
  },

  // ── QR ─────────────────────────────────────────────────────────────────────────
  {
    id: "qr-how",
    category: "qr",
    question: "How do I get a QR code?",
    answer: [
      "Open Share for a file (Files › ⋮ › Share) or for a playlist, and choose Show QR code. From there you can download the QR image or copy the link. Scanning it opens the same Onfile link.",
    ],
  },

  // ── Ads & unlocking ────────────────────────────────────────────────────────────
  {
    id: "ads-step",
    category: "ads",
    question: "What is the advertisement step?",
    answer: [
      `Before a file without a password is revealed, visitors see a short timed advertisement step (${AD_SECONDS} seconds) on the file page. When it ends, they can continue to get the file. The server still decides whether to reveal the link.`,
      "Onfile does not promise that an advertisement is shown to every visitor, or that any ad produces revenue.",
    ],
    keywords: ["ad", "countdown", "wait"],
  },
  {
    id: "ads-unlock-methods",
    category: "ads",
    question: "How can a file be unlocked?",
    answer: [
      "With the timed advertisement step, or — if the creator set a password — with that password. A Stars price can be listed, but Telegram Stars checkout is not available yet and nothing is charged.",
    ],
    keywords: ["stars", "paid"],
  },
  {
    id: "advertise-with-us",
    category: "ads",
    question: "What does \"Advertise with Us\" do?",
    answer: [
      "It is a form (Me › Advertise with Us) where an advertiser can send an enquiry with contact and campaign details. Submitting it does not create a contract or a guaranteed campaign.",
    ],
  },

  // ── Wallet ─────────────────────────────────────────────────────────────────────
  {
    id: "wallet-overview",
    category: "wallet",
    question: "What do the numbers in the Wallet mean?",
    answer: [
      `Available Balance is what you can request to withdraw. Pending is money tied up in withdrawal requests that are not completed. Referral and All Time show referral earnings and total earned. Amounts are shown in ${CURRENCY}, and the app treats 1 USDT as about 1 USD.`,
    ],
    keywords: ["balance", "usdt"],
  },
  {
    id: "earnings-guarantee",
    category: "wallet",
    question: "How much will I earn?",
    answer: [
      "Onfile cannot guarantee any amount. Earnings depend on whether people open your content, advertising availability, and monetization and eligibility rules that apply to your account and may change. A balance of zero means nothing has been credited to your account yet.",
    ],
    keywords: ["money", "revenue", "income", "pay"],
  },
  {
    id: "transactions",
    category: "wallet",
    question: "Where do I see my transaction history?",
    answer: [
      "In the Wallet tab, the Transactions list shows your most recent entries with their amount, a status label and when they happened. The Withdrawals list shows your withdrawal requests with their status.",
    ],
  },

  // ── Withdrawals ────────────────────────────────────────────────────────────────
  {
    id: "min-withdrawal",
    category: "withdrawals",
    question: "What is the minimum withdrawal?",
    answer: [
      `The minimum is ${MIN} (${MIN_WITHDRAWAL_USD} USDT). Requests below this are rejected by the server and your balance is not changed. Your available balance must also cover the amount.`,
    ],
    keywords: ["minimum", "$10", "10 usd", "limit"],
  },
  {
    id: "withdraw-steps",
    category: "withdrawals",
    question: "How do I request a withdrawal?",
    answer: ["In the Wallet tab:"],
    steps: [
      "Tap Withdraw Now.",
      `Enter an amount of at least ${MIN} that is not more than your available balance.`,
      `Choose the network (${NETWORKS}) that matches your wallet.`,
      "Enter your wallet address and double-check it.",
      "Tap Submit Request. The amount moves from Available to Pending and the request appears under Withdrawals.",
    ],
    keywords: ["payout", "cash out", "usdt", "crypto"],
  },
  {
    id: "withdraw-methods",
    category: "withdrawals",
    question: "Which currencies and networks are supported?",
    answer: [
      `Withdrawals are in ${CURRENCY} on ${NETWORKS}. PayPal appears as \"coming soon\" and is not available.`,
    ],
  },
  {
    id: "withdraw-status",
    category: "withdrawals",
    question: "What do withdrawal statuses mean?",
    answer: [
      "Pending: the request was received and is waiting for review. Processing: it is being handled. Completed: it was sent (a transaction reference may be shown). Rejected: it was not accepted — a reason may be shown. Cancelled: it was cancelled.",
    ],
  },
  {
    id: "withdraw-time",
    category: "withdrawals",
    question: "How long does a withdrawal take?",
    answer: [
      "The Withdraw screen shows an estimated processing time. It is an estimate, not a guarantee; actual time can vary with review and network conditions.",
    ],
    keywords: ["how long", "delay", "when"],
  },
  {
    id: "withdraw-wrong-address",
    category: "withdrawals",
    question: "What if I enter the wrong wallet address or network?",
    answer: [
      "Crypto transfers are usually irreversible, so funds sent to a wrong address or network can be lost. Check the address and network before you submit. Onfile checks only that the address looks like an address, not that it belongs to you.",
    ],
  },
  {
    id: "withdraw-errors",
    category: "withdrawals",
    question: "Why was my withdrawal request refused?",
    answer: ["Common messages:"],
    steps: [
      `\"Minimum withdrawal is ${MIN}\": enter at least ${MIN_WITHDRAWAL_USD}.`,
      "\"Insufficient balance\": the amount is more than your available balance.",
      "\"Enter a valid amount\": use numbers only, up to 6 decimal places, no commas or letters.",
      "\"Already submitted\": the same request was sent within the last minute — check your withdrawal history before trying again.",
      "\"Enter a valid wallet address\": remove spaces and special characters, or check the address is complete.",
    ],
    keywords: ["error", "rejected", "failed", "invalid"],
  },
  {
    id: "withdraw-double",
    category: "withdrawals",
    question: "What if I tap Submit twice?",
    answer: [
      "Onfile protects against this. Only one request is created, and your balance is deducted once. A refused request never takes money from your balance.",
    ],
  },

  // ── Referrals ──────────────────────────────────────────────────────────────────
  {
    id: "referral-what",
    category: "referrals",
    question: "How does the Referral Program work?",
    answer: [
      "Me › Referral Program shows your referral code and link, a list of creators recorded as referred by you, and the commission described in the app. Commission is subject to the Terms & Conditions and to verification. Onfile cannot guarantee that a referral will be recorded or that any commission will be earned or paid, and may withhold commission for abuse such as fake accounts.",
    ],
    keywords: ["invite", "commission", "code"],
  },

  // ── Settings ───────────────────────────────────────────────────────────────────
  {
    id: "edit-profile",
    category: "settings",
    question: "How do I change my name or username?",
    answer: [
      "Go to Me and tap the gear icon next to your profile to open Account Settings. Edit Display Name and Username and tap Save Changes. This changes how you appear in Onfile (including on your file pages) but does not change your Telegram profile.",
    ],
  },
  {
    id: "theme",
    category: "settings",
    question: "How do I switch between light and dark mode?",
    answer: [
      "In Me › Preferences, use the dark-mode switch. By default Onfile follows your device setting until you choose one; your choice is remembered on this device.",
    ],
    keywords: ["theme", "dark", "light"],
  },
  {
    id: "language",
    category: "settings",
    question: "Can I change the language?",
    answer: ["Onfile is currently available in English only."],
  },

  // ── Privacy ────────────────────────────────────────────────────────────────────
  {
    id: "privacy-files",
    category: "privacy",
    question: "Where are my original files kept?",
    answer: [
      "In your own private Telegram channel, stored by Telegram. Onfile does not store original files. It stores the link to the post, your descriptions, and thumbnails you choose to add. Read the full Privacy & Security page in Me for the details.",
    ],
  },
  {
    id: "privacy-who-sees",
    category: "privacy",
    question: "What can other people see about me?",
    answer: [
      "People who open your file or playlist page can see your display name, @username and Telegram profile photo as the creator, plus the file details. Your balances, withdrawals, Telegram ID and notifications are only visible to you.",
    ],
  },
  {
    id: "privacy-third-parties",
    category: "privacy",
    question: "Which third-party services does Onfile use?",
    answer: [
      "Telegram (sign-in, the bot, your channel and file delivery), Vercel (hosting), a hosted PostgreSQL database, and DBByte (thumbnail storage). The app does not load third-party analytics or advertising SDKs. See Privacy & Security for details.",
    ],
  },
  {
    id: "privacy-secure",
    category: "privacy",
    question: "How is my account protected?",
    answer: [
      "Sign-in uses Telegram's verified launch data; sessions use random tokens in secure HTTP-only cookies; file passwords are stored hashed; sensitive actions are checked on the server. No system is perfectly secure and Onfile has no independent security certification. Keep your Telegram account secure, for example with two-step verification.",
    ],
  },

  // ── Troubleshooting ────────────────────────────────────────────────────────────
  {
    id: "ts-app-wont-load",
    category: "troubleshooting",
    question: "The app shows an error or keeps loading.",
    answer: ["Try these in order:"],
    steps: [
      "Check your internet connection.",
      "Close the Mini App and reopen it from the Onfile bot in Telegram.",
      "Update Telegram to the latest version.",
      "If it still fails, try again a little later; a temporary outage can happen.",
    ],
    keywords: ["blank", "not loading", "unauthorized", "session"],
  },
  {
    id: "ts-link-verify",
    category: "troubleshooting",
    question: "My post link won't verify when publishing.",
    answer: ["Check the message shown:"],
    steps: [
      "Post not found: check the link and that the post still exists.",
      "Wrong channel: the link must be from your connected channel.",
      "Can't be copied: channels or posts with \"Restrict saving content\" enabled cannot be checked; turn it off or use another post.",
      "Bot access problem: make sure the Onfile bot is still an administrator with Post Messages.",
      "Open the Onfile bot chat and press Start, then try again.",
    ],
    keywords: ["verify", "post link", "restrict saving"],
  },
  {
    id: "ts-thumbnail",
    category: "troubleshooting",
    question: "My thumbnail won't upload.",
    answer: [
      `Use a JPEG, PNG or WebP image no larger than ${THUMBNAIL_MAX_LABEL}. If it still fails, try a different image or check your connection. Thumbnails can also be temporarily unavailable if image storage is full or offline; your file still works without one.`,
    ],
  },
  {
    id: "ts-link-not-found",
    category: "troubleshooting",
    question: "A file or playlist link says it is not found.",
    answer: [
      "The file may be unpublished, deleted or never published, or the playlist may be private or not shared. If you are the creator, check it in Files and publish or make it public again.",
    ],
  },
  {
    id: "ts-saved-missing",
    category: "troubleshooting",
    question: "My saved items disappeared.",
    answer: [
      "Saved items live only in your device's browser storage. They can be lost if you clear app data, reinstall Telegram or use another device.",
    ],
  },
  {
    id: "ts-balance",
    category: "troubleshooting",
    question: "My balance looks wrong.",
    answer: [
      "Reopen the Wallet tab to refresh the figures. Requested withdrawals move from Available to Pending until they are handled, so Available drops when you request one. If something still looks wrong, use the contact details in Privacy & Security once they are published.",
    ],
  },

  // ── Support & restrictions ─────────────────────────────────────────────────────
  {
    id: "support-contact",
    category: "support",
    question: "How do I contact Onfile support?",
    answer: [
      "Onfile does not currently have a live chat or an in-app support desk, and the Contact Support row in Me is not active yet. Contact details are published in the Privacy & Security and Terms & Conditions pages once the operator has configured them.",
    ],
    keywords: ["help", "email", "contact", "support"],
  },
  {
    id: "restrictions",
    category: "support",
    question: "Why might content or an account be restricted?",
    answer: [
      "Onfile may restrict or remove content, disable links, withhold funds or suspend an account that breaches the Terms & Conditions, for example by sharing infringing, harmful or illegal content, abusing monetization, or manipulating views or referrals. See Terms & Conditions for the rules.",
    ],
    keywords: ["ban", "suspended", "removed", "violation"],
  },
  {
    id: "copyright-complaint",
    category: "support",
    question: "How do I report copyright infringement?",
    answer: [
      "Use the flag icon on the file or playlist page and choose Copyright, or use the copyright contact in Terms & Conditions once it is published. Include enough detail to identify the content and your rights. Onfile does not promise a particular response time.",
    ],
  },
];
