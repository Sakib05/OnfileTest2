import { MIN_WITHDRAWAL_USD } from "@/lib/money";
import { DISPLAY_NAME_MAX } from "@/lib/profile";
import { PROFILE_IMAGE_MAX_LABEL } from "@/lib/profile";

/**
 * FAQ & Help knowledge base (local, maintainable content — no database table needed).
 *
 * Every answer below was written against the actual code in this repository (publish flow, channel verification,
 * viewer/unlock flow, playlists, wallet, reports). Where a feature is NOT implemented (e.g. Telegram Stars payments,
 * revenue rates, payout timelines, account deletion) the answer says so or stays silent — nothing is invented.
 */

export type FaqCategoryId =
  | "getting-started"
  | "channel"
  | "files"
  | "playlists"
  | "sharing"
  | "monetization"
  | "account"
  | "copyright"
  | "troubleshooting";

export interface FaqItem {
  id: string;
  category: FaqCategoryId;
  question: string;
  /** Paragraphs. A line starting with "• " is rendered as a list item. */
  answer: string[];
}

export const FAQ_CATEGORIES: { id: FaqCategoryId; title: string; blurb: string }[] = [
  { id: "getting-started", title: "Getting Started", blurb: "What Onfile is and how to begin" },
  { id: "channel", title: "Telegram Channel Connection", blurb: "Connect, verify and reconnect your private channel" },
  { id: "files", title: "File Management", blurb: "Publishing, editing and deleting files" },
  { id: "playlists", title: "Playlists", blurb: "Group files and share them together" },
  { id: "sharing", title: "Sharing & Access", blurb: "Links, QR codes and protected content" },
  { id: "monetization", title: "Advertisements & Monetization", blurb: "Earnings, wallet and withdrawals" },
  { id: "account", title: "Profile & Account", blurb: "Name, picture and account safety" },
  { id: "copyright", title: "Copyright & Reporting", blurb: "What's allowed and how to report content" },
  { id: "troubleshooting", title: "Troubleshooting", blurb: "Practical fixes for common problems" },
];

export const FAQ_ITEMS: FaqItem[] = [
  // ── A. Getting started ──────────────────────────────────────────────────────────────────────────────────────────
  {
    id: "gs-what",
    category: "getting-started",
    question: "What is Onfile?",
    answer: [
      "Onfile is a Telegram Mini App for creators. You keep your original files in your own private Telegram channel, and Onfile gives each file a shareable link, optional password protection, playlists, thumbnails and a wallet for creator earnings.",
      "Onfile does not host your original files. They stay in your Telegram channel.",
    ],
  },
  {
    id: "gs-how",
    category: "getting-started",
    question: "How does Onfile work?",
    answer: [
      "• You connect a private Telegram channel and add the Onfile bot as an administrator.",
      "• You post your file in that channel using Telegram.",
      "• In Create, you paste the link of that Telegram post. Onfile checks that the exact post exists in your connected channel.",
      "• You add a title, optional description, thumbnail, playlist and access settings, then publish to get a link.",
      "• People you share the link with open it in Onfile, complete the access step, and are taken to the original post through Telegram.",
    ],
  },
  {
    id: "gs-who",
    category: "getting-started",
    question: "Who can use Onfile?",
    answer: [
      "Creators need a Telegram account and a private Telegram channel they administer, where the Onfile bot can be added as an administrator. Anyone with a creator's link can open it with Telegram. There is no public feed or Explore page: content is only reachable through links that creators share.",
    ],
  },
  {
    id: "gs-account",
    category: "getting-started",
    question: "How do I create a creator account?",
    answer: [
      "Open Onfile from Telegram. Onfile signs you in using your Telegram identity, which is verified on the server. Your creator account is created once you have connected and verified a private channel, so there is no separate sign-up form or password.",
    ],
  },
  {
    id: "gs-monetize",
    category: "getting-started",
    question: "How do I start monetizing my files?",
    answer: [
      "Connect your channel, publish files and share their links. Earnings, pending balance and withdrawals appear in the Wallet tab. Onfile does not guarantee any specific earnings.",
      "Selling a file for Telegram Stars is not active yet. A post set to \"paid\" can be saved as an unpublished draft or published as free content.",
    ],
  },

  // ── B. Channel connection ───────────────────────────────────────────────────────────────────────────────────────
  {
    id: "ch-why",
    category: "channel",
    question: "Why does Onfile require a Telegram channel?",
    answer: [
      "Onfile needs a verified connection to your channel so it can confirm you are the creator behind the content and so your originals can stay in Telegram instead of being copied to Onfile. Publishing, playlists, sharing and earnings require a verified channel.",
    ],
  },
  {
    id: "ch-connect",
    category: "channel",
    question: "How do I connect my private channel?",
    answer: [
      "During setup, or later from Me → Channel Management → Connect New Channel, choose how to connect:",
      "• Direct picker: on Telegram versions that support it, pick your channel in Telegram's own selection screen from inside Onfile and approve the bot's admin access.",
      "• Via bot: if direct selection isn't available, Onfile opens the Onfile Bot chat. Tap \"Select channel to connect\", choose your private channel, then return to Onfile.",
      "• Manual: add the Onfile bot as administrator from your channel settings and paste the channel's private invite link.",
      "Every method ends with the same server-side verification before a connection becomes active.",
    ],
  },
  {
    id: "ch-private",
    category: "channel",
    question: "Why must the channel be private?",
    answer: [
      "Onfile is built around private channels so access to your content stays under your control. The server rejects any channel that has a public @username, even if the bot already has admin rights there. If you picked a public channel, remove the bot from it yourself in Telegram and connect a private one instead.",
    ],
  },
  {
    id: "ch-admin",
    category: "channel",
    question: "Why does the Onfile bot need administrator permissions?",
    answer: [
      "Telegram only lets a bot work with a channel's posts if it is an administrator. Onfile asks for the \"Post Messages\" right only; other rights (editing channel info, deleting messages, inviting or removing members, promoting admins and so on) are left disabled.",
    ],
  },
  {
    id: "ch-remove-bot",
    category: "channel",
    question: "What happens if I remove the bot from my channel?",
    answer: [
      "Onfile can no longer verify posts in that channel or use it for new publishing, and links that depend on it may stop working. Your files are not deleted; they remain in your channel. Add the bot back as an administrator with the \"Post Messages\" right and reconnect the channel.",
    ],
  },
  {
    id: "ch-reconnect",
    category: "channel",
    question: "How can I reconnect my channel?",
    answer: [
      "Go to Me → Channel Management → Connect New Channel, then select the same channel again using any connection method. You can also disconnect a channel there; Onfile makes a best-effort attempt to remove its bot from the channel when you do.",
    ],
  },
  {
    id: "ch-fail",
    category: "channel",
    question: "What should I do if channel verification fails?",
    answer: [
      "Read the message shown: it tells you whether the channel must be private, whether the bot still needs to be added or made an administrator, or whether the \"Post Messages\" right is missing. Fix that in Telegram, then tap Try Again or resubmit the link. Onfile re-checks live data from Telegram every time. Also make sure you are an administrator of the channel yourself.",
    ],
  },

  // ── C. File management ──────────────────────────────────────────────────────────────────────────────────────────
  {
    id: "f-upload",
    category: "files",
    question: "How do I upload files?",
    answer: [
      "You upload the original file to your private Telegram channel using Telegram. Then open Create in Onfile and paste the link to that post. Onfile verifies that the exact post exists in your connected channel before letting you continue, and nothing is posted in your channel while it checks.",
    ],
  },
  {
    id: "f-where",
    category: "files",
    question: "Where are original files stored?",
    answer: ["On Telegram, in your own private channel. They never move to Onfile."],
  },
  {
    id: "f-store",
    category: "files",
    question: "Does Onfile store my original files?",
    answer: [
      "No. Onfile does not download or store the original files on its own application server. It stores a record of each published file (title, description, the Telegram post link, access settings, counters). Optional thumbnails are stored separately in an image storage service, and a file password, if set, is stored only as a salted hash.",
    ],
  },
  {
    id: "f-delivery",
    category: "files",
    question: "How does file delivery work?",
    answer: [
      "Delivery uses Telegram. When someone opens your Onfile link and completes the access step (an advertisement step, or the password for protected files), Onfile gives them an \"Open in Telegram\" action that leads to the original post in your channel. Onfile does not make its own copy of the file.",
    ],
  },
  {
    id: "f-edit",
    category: "files",
    question: "Can I edit a file's title and description?",
    answer: ["Yes. In Files (My Library), tap ⋮ on a file and choose Edit details. The title is required; the description is optional."],
  },
  {
    id: "f-thumb",
    category: "files",
    question: "How do I change a thumbnail?",
    answer: [
      "In Files, tap ⋮ on the file and choose Edit details (the thumbnail is part of it) or Change thumbnail. Thumbnails can be JPG, PNG or WebP, up to 2 MB. You can also remove a thumbnail to go back to the default file artwork.",
    ],
  },
  {
    id: "f-delete",
    category: "files",
    question: "Can I delete a file from My Library?",
    answer: [
      "Yes. In Files, tap ⋮ on the file and choose Delete. The dialog lists any playlists affected. The file's Onfile link stops working and its thumbnail is removed.",
    ],
  },
  {
    id: "f-delete-original",
    category: "files",
    question: "Does deleting a file from Onfile delete the original Telegram channel post?",
    answer: [
      "No. Deleting a file in Onfile only removes it from Onfile. Onfile never deletes anything from your Telegram channel. If you also want the post gone, delete it yourself in Telegram.",
    ],
  },

  // ── D. Playlists ────────────────────────────────────────────────────────────────────────────────────────────────
  {
    id: "p-what",
    category: "playlists",
    question: "What is a playlist?",
    answer: ["A playlist is an ordered group of your files that can be shared with one link. Viewers see the selected file with the rest of the playlist listed below it."],
  },
  {
    id: "p-create",
    category: "playlists",
    question: "How do I create a playlist?",
    answer: ["You can create a playlist while publishing a file (Details step), and you manage playlists from the Playlists view in Files."],
  },
  {
    id: "p-members",
    category: "playlists",
    question: "How do I add or remove files?",
    answer: [
      "Open the playlist and use Add files to add files from your library, or remove a file from its menu. From My Library you can also use Manage playlists on a file to choose which playlists it belongs to. Removing a file from a playlist does not delete the file.",
    ],
  },
  {
    id: "p-reorder",
    category: "playlists",
    question: "How do I reorder files?",
    answer: ["Open the playlist and drag files using their handles to change the order. The order is saved for everyone who opens the playlist."],
  },
  {
    id: "p-share",
    category: "playlists",
    question: "Can I share a playlist?",
    answer: [
      "Yes. In the playlist's menu choose Share settings to share the playlist, copy its link or show a QR code. A playlist must be public to be opened through its link; choose Make private to stop it being reachable.",
    ],
  },
  {
    id: "p-password",
    category: "playlists",
    question: "Can I protect a playlist with a password?",
    answer: ["Yes. Playlist menu → Monetization settings lets you set or clear a password. Files can also have their own password, and each file's own rules still apply inside a playlist."],
  },
  {
    id: "p-links",
    category: "playlists",
    question: "How do playlist links work?",
    answer: [
      "A shared playlist has a public link (a short /p/ link). Anyone with it can open the playlist page, subject to its password if set. Opening a file from the playlist asks the server to check that file's own password and advertisement rules before access is given.",
    ],
  },

  // ── E. Sharing & access ─────────────────────────────────────────────────────────────────────────────────────────
  {
    id: "s-share",
    category: "sharing",
    question: "How do I share a file?",
    answer: ["In Files, tap ⋮ on a file and choose Share, then pick how to send the link. Only people who receive your link can find the file."],
  },
  {
    id: "s-copy",
    category: "sharing",
    question: "How do I copy a file link?",
    answer: ["Files → ⋮ on the file → Share → Copy link."],
  },
  {
    id: "s-qr",
    category: "sharing",
    question: "How do I generate or display a QR code?",
    answer: ["Files → ⋮ on the file → Share → Show QR code. Playlists have the same option in their Share dialog. The QR code simply contains the same link."],
  },
  {
    id: "s-access",
    category: "sharing",
    question: "How do users access private content?",
    answer: [
      "They open your link. The page checks the file on the server. Depending on the file they either complete the advertisement step or enter the password, and then receive an \"Open in Telegram\" action to reach the original post. Unpublished files are not reachable.",
    ],
  },
  {
    id: "s-password",
    category: "sharing",
    question: "What happens when a file is password-protected?",
    answer: ["The password is required to unlock the file, and the server checks it. Passwords are stored as salted hashes, not as plain text. Wrong attempts are rate-limited."],
  },
  {
    id: "s-qr-bypass",
    category: "sharing",
    question: "Can a QR code bypass access restrictions?",
    answer: ["No. A QR code is just another way to carry the same link, so it goes through the same page and the same server checks (password, advertisement step, published status)."],
  },

  // ── F. Ads & monetization ───────────────────────────────────────────────────────────────────────────────────────
  {
    id: "m-ads",
    category: "monetization",
    question: "How do advertisements work?",
    answer: [
      "For files that are not password-protected, the viewer first goes through a short advertisement step (a countdown) before the file can be opened. Password-protected files are unlocked with the password instead.",
    ],
  },
  {
    id: "m-why-ads",
    category: "monetization",
    question: "Why might users see advertisements before accessing files?",
    answer: ["The advertisement step is part of how Onfile supports creator monetization. It appears before access is granted on files that use it."],
  },
  {
    id: "m-earn",
    category: "monetization",
    question: "How do creators earn money?",
    answer: [
      "Creators earn through activity on their published content as recorded in the Wallet (available balance, pending balance, referral and all-time earnings). Onfile does not promise any amount, rate or number of ads.",
    ],
  },
  {
    id: "m-calc",
    category: "monetization",
    question: "How are creator earnings calculated?",
    answer: [
      "Onfile does not publish a fixed revenue rate in the app, and this Help section does not state one. Your Wallet shows the amounts that have actually been recorded to your account. Earnings are not guaranteed.",
    ],
  },
  {
    id: "m-when",
    category: "monetization",
    question: "When can creators withdraw money?",
    answer: [
      `Whenever your available balance is at least $${MIN_WITHDRAWAL_USD}. Open Wallet → Withdraw Now, enter the amount, the network and your wallet address. The request is recorded as pending and appears in your withdrawal history. Onfile does not promise a specific processing time.`,
    ],
  },
  {
    id: "m-min",
    category: "monetization",
    question: "What is the minimum withdrawal amount?",
    answer: [
      `The minimum withdrawal amount is $${MIN_WITHDRAWAL_USD} USD (${MIN_WITHDRAWAL_USD} USDT at the app's 1:1 display rate). Requests below this are rejected by the server, and no balance is deducted.`,
    ],
  },

  // ── G. Profile & account ────────────────────────────────────────────────────────────────────────────────────────
  {
    id: "a-name",
    category: "account",
    question: "How do I change my display name?",
    answer: [`Me → Edit Profile → change Display Name → Save. Names can be up to ${DISPLAY_NAME_MAX} characters and can't be empty.`],
  },
  {
    id: "a-picture",
    category: "account",
    question: "How do I change my profile picture?",
    answer: [
      `Me → Edit Profile → Change photo. Choose a JPG, PNG or WebP image up to ${PROFILE_IMAGE_MAX_LABEL}, check the preview, then Save. You can cancel before saving. If you never upload one, your usual default picture stays.`,
    ],
  },
  {
    id: "a-username",
    category: "account",
    question: "Can I change my Telegram username through Onfile?",
    answer: [
      "No. Your Display Name and profile picture can be changed in Onfile, but your Telegram username cannot. It is shown read-only and follows your Telegram account; to change it, change it in Telegram.",
    ],
  },
  {
    id: "a-secure",
    category: "account",
    question: "How do I secure my account?",
    answer: [
      "Onfile signs you in with Telegram, so protect your Telegram account: enable Two-Step Verification in Telegram and never share login codes or passwords with anyone, including people claiming to be Onfile. Only connect channels you control, and keep your channel's administrator list limited to people you trust.",
    ],
  },

  // ── H. Copyright & reporting ────────────────────────────────────────────────────────────────────────────────────
  {
    id: "c-allowed",
    category: "copyright",
    question: "What content can I upload?",
    answer: ["Only content you own or have the legal right to distribute. You are responsible for having that right for everything you publish through Onfile."],
  },
  {
    id: "c-prohibited",
    category: "copyright",
    question: "What content is prohibited?",
    answer: ["Illegal, stolen or infringing content, malware, spam or misleading content, and other content that breaks the law or the Terms & Conditions. See Terms & Conditions for the full list."],
  },
  {
    id: "c-report",
    category: "copyright",
    question: "How do I report copyrighted content?",
    answer: [
      "Open the file or playlist link and use Report. Choose a reason (for example Copyright or unauthorized content), add optional details and submit.",
    ],
  },
  {
    id: "c-after",
    category: "copyright",
    question: "What happens after a report is submitted?",
    answer: [
      "The report is recorded against the file or playlist for review. Onfile does not promise automatic removal or a specific review time, and the reporter is not shown a case status in the app.",
    ],
  },
  {
    id: "c-responsible",
    category: "copyright",
    question: "Who is responsible for uploaded content?",
    answer: ["The creator who publishes it. Onfile does not review files before they are shared, and the original files stay in the creator's own Telegram channel."],
  },

  // ── I. Troubleshooting ──────────────────────────────────────────────────────────────────────────────────────────
  {
    id: "t-delivery",
    category: "troubleshooting",
    question: "File delivery failed",
    answer: [
      "• Confirm the file is published and the link is correct.",
      "• Make sure the original post still exists in the creator's channel and the channel is still connected.",
      "• Check your connection, reopen the link and try Get File again.",
      "• If the \"Open in Telegram\" action does nothing, update Telegram and make sure you can access the channel post.",
      "• Creators: re-verify the channel under Me → Channel Management.",
    ],
  },
  {
    id: "t-channel",
    category: "troubleshooting",
    question: "Channel connection failed",
    answer: [
      "• Use a private channel (no public @username).",
      "• Add the Onfile bot as administrator with \"Post Messages\".",
      "• Confirm you are an administrator of the channel.",
      "• Try another connection method (direct picker, via bot or manual) and tap Try Again.",
    ],
  },
  {
    id: "t-playlist",
    category: "troubleshooting",
    question: "Playlist link does not work",
    answer: [
      "• Check that the playlist is public (not made private) and that you copied the full link.",
      "• Ask the creator whether the playlist or its files were deleted or unpublished.",
      "• Open the link directly in Telegram rather than from a cached message.",
    ],
  },
  {
    id: "t-password",
    category: "troubleshooting",
    question: "Password is not accepted",
    answer: [
      "• Passwords are case-sensitive; check for extra spaces from copy and paste.",
      "• After several wrong attempts, wait a minute before trying again.",
      "• Passwords are stored as hashes and can't be read back. Creators can set a new password in the file or playlist settings.",
    ],
  },
  {
    id: "t-avatar",
    category: "troubleshooting",
    question: "Profile picture upload failed",
    answer: [
      `• Use a JPG, PNG or WebP image up to ${PROFILE_IMAGE_MAX_LABEL}; animated images aren't accepted.`,
      "• Try a different image; a corrupt file will be rejected.",
      "• If you see \"Image storage is not available\" or \"busy\", try again a little later.",
    ],
  },
  {
    id: "t-withdraw",
    category: "troubleshooting",
    question: "Withdrawal request failed",
    answer: [
      `• The amount must be at least $${MIN_WITHDRAWAL_USD}, and no more than your available balance.`,
      "• Choose a supported network and enter the wallet address exactly, with no spaces.",
      "• If you just sent the same request, wait a minute: identical repeat requests are blocked to prevent double withdrawals.",
      "• A failed request never deducts your balance.",
    ],
  },
  {
    id: "t-loading",
    category: "troubleshooting",
    question: "Application is not loading",
    answer: [
      "• Open Onfile from inside Telegram (not a normal browser).",
      "• Check your internet connection and close and reopen the Mini App.",
      "• Update Telegram to the latest version.",
      "• If it still fails, wait a few minutes and try again; the service may be temporarily unavailable.",
    ],
  },
];
