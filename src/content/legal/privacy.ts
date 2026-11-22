import {
  LEGAL_CONFIG,
  isLegalValueSet,
  legalValue,
  privacyContact,
  type LegalConfig,
} from "@/config/legal";
import { THUMBNAIL_MAX_LABEL } from "@/lib/publishing/constants";
import type { DocSection } from "./types";

/**
 * Privacy & Security — content.
 *
 * Every statement here was written from what the repository actually does (database schema, API routes, Telegram
 * bot code, thumbnail storage, cookies). Statements about things that could NOT be verified from the code
 * (production hosting settings, the database vendor, retention beyond what the code enforces) are worded
 * conservatively and listed in the delivery report. Legal-entity facts come from src/config/legal.ts and show a
 * marked placeholder until configured.
 */
export function buildPrivacySections(config: LegalConfig = LEGAL_CONFIG): DocSection[] {
  const operator = isLegalValueSet("operatorName", config) ? legalValue("operatorName", config) : "the operator of Onfile";
  const dbProvider = isLegalValueSet("databaseProvider", config)
    ? `a hosted PostgreSQL database (${legalValue("databaseProvider", config)})`
    : "a hosted PostgreSQL database provider";

  return [
    {
      id: "introduction",
      title: "Introduction",
      blocks: [
        {
          type: "p",
          text: `Onfile is a Telegram Mini App that lets creators share files with a link and lets other people open those links. It is operated by ${operator}. This page explains what information Onfile handles, where it is kept, who it is shared with, and how you can protect your account.`,
        },
        {
          type: "p",
          text: "The central design point is that your original files stay in Telegram. Creators keep their files in their own private Telegram channel; Onfile stores links and descriptive information about those files, not the files themselves.",
        },
      ],
    },
    {
      id: "information-we-collect",
      title: "Information We Collect",
      blocks: [
        { type: "p", text: "Depending on how you use Onfile, we handle these categories of information:" },
        {
          type: "ul",
          items: [
            "Telegram account information, supplied by Telegram when you open the Mini App (see below).",
            "Profile information you can edit in Onfile (display name and username).",
            "Content information about the files and playlists creators publish: titles, descriptions, categories, file type and size, access settings, the Telegram post link, and thumbnails.",
            "Channel connection information: the Telegram channel's ID, name and connection status.",
            "Wallet information: balances, transaction records and withdrawal requests, including the wallet address and network you enter.",
            "Reports submitted from file or playlist pages, including the reason, any details written, and the reporter's IP address.",
            "Advertising enquiries submitted through the \"Advertise with Us\" form: name, email, campaign details.",
            "Technical and usage information: login sessions, view/download counters, and notifications generated for your account.",
          ],
        },
        { type: "p", text: "Viewers who only open a shared link do not need an Onfile account and are not asked to sign up." },
      ],
    },
    {
      id: "telegram-account-information",
      title: "Telegram Account Information",
      blocks: [
        {
          type: "p",
          text: "When you open Onfile inside Telegram, Telegram passes the app a signed launch payload. The server checks Telegram's signature before trusting it. From it Onfile stores:",
        },
        {
          type: "ul",
          items: [
            "Your Telegram user ID.",
            "Your Telegram username, first name and last name (if set).",
            "The address of your Telegram profile photo. Onfile stores the link to the picture hosted by Telegram; it does not copy the image.",
            "Your Telegram language code.",
          ],
        },
        {
          type: "p",
          text: "Onfile does not receive your Telegram password, phone number or your private chats. An account is created when a creator completes connecting a verified private channel. Onfile also stores the identifier of your private chat with the Onfile bot, so the bot can send you connection prompts and confirmations.",
        },
      ],
    },
    {
      id: "profile-information",
      title: "Profile Information",
      blocks: [
        {
          type: "p",
          text: "In Me › Account Settings you can change the display name and username shown in Onfile. Changing them in Onfile does not change your Telegram profile. Your display name, @username and Telegram photo are shown to people who open your shared files, as the creator of the file. Your balances, Telegram ID and email are not shown on public pages.",
        },
        {
          type: "p",
          text: "Your theme choice (light/dark) is kept on your device. Your referral code is generated by Onfile and shown in the Referral Program screen.",
        },
      ],
    },
    {
      id: "file-and-content-handling",
      title: "File & Content Handling",
      blocks: [
        {
          type: "p",
          text: "Original files are not uploaded to Onfile. A creator posts the file in their own private Telegram channel and gives Onfile the link to that post. The original file therefore remains in the creator's Telegram channel and is stored by Telegram. Onfile does not claim ownership of creators' files.",
        },
        { type: "p", text: "What Onfile does store, in its database:" },
        {
          type: "ul",
          items: [
            "The Telegram post link and, where available, Telegram's internal file identifier for the post — references, not the file.",
            "Details the creator typed: title, description, category, file type, size, and any access password (stored as a protected hash, not as plain text) or listed Stars price.",
            "Playlist details, ordering, and share links.",
            "Counters such as views and downloads.",
          ],
        },
        {
          type: "p",
          text: `Thumbnails, profile images and metadata are different from original files. If a creator adds a thumbnail (JPEG, PNG or WebP, up to ${THUMBNAIL_MAX_LABEL}), the image is processed and a copy is stored with Onfile's image storage provider (see "Data Storage & Third-Party Services"). Thumbnails are delivered from a public content-delivery address, so anyone who has that address can view the thumbnail. Do not use sensitive images as thumbnails.`,
        },
        {
          type: "p",
          text: "Deleting a file in Onfile removes it from the creator's Library, removes its Onfile link and removes Onfile's thumbnail copy. It does not delete the post from the Telegram channel.",
        },
      ],
    },
    {
      id: "telegram-channel-integration",
      title: "Telegram Channel Integration",
      blocks: [
        {
          type: "p",
          text: "Creators connect their own channel. Onfile only accepts private channels (channels without a public @username), and only after checking with Telegram that the person connecting is the channel's owner and that the Onfile bot is an administrator there.",
        },
        {
          type: "p",
          text: "The Onfile bot asks for administrator rights limited to Post Messages. Other administrator rights (such as changing channel info, deleting messages, inviting or removing members, adding admins, managing video chats, or stories) are not requested.",
        },
        { type: "p", text: "What the bot and Onfile do with that access:" },
        {
          type: "ul",
          items: [
            "Verify the connection and store the channel's Telegram ID, name and verification status.",
            "Check that a post link a creator submits really exists in the connected channel. To do this, the bot asks Telegram to copy that post into the creator's private chat with the bot, silently, and then deletes the copy. Nothing is posted to the channel.",
            "Receive Telegram updates about the bot's membership of channels (for example, when the bot is added or removed as an administrator), so Onfile can show an accurate connection status.",
          ],
        },
        {
          type: "p",
          text: "A creator can disconnect a channel at any time in Me › Channel Management. Onfile then tries to remove the bot from the channel; the creator can also remove the bot in Telegram themselves.",
        },
      ],
    },
    {
      id: "how-we-use-information",
      title: "How We Use Information",
      blocks: [
        {
          type: "ul",
          items: [
            "To sign you in with your Telegram identity and keep you signed in.",
            "To connect and verify your channel and publish files, playlists and share links.",
            "To show the file or playlist page and, after the access step, the link that opens the file in Telegram.",
            "To keep your wallet, withdrawal requests and notifications.",
            "To show statistics (views, downloads, earnings) to the creator.",
            "To review reports, protect the service from abuse (for example with rate limits) and enforce the Terms & Conditions.",
            "To respond to advertising enquiries.",
          ],
        },
        { type: "p", text: "Onfile does not sell personal information." },
      ],
    },
    {
      id: "data-storage-third-parties",
      title: "Data Storage & Third-Party Services",
      blocks: [
        { type: "p", text: "Onfile relies on these services. Each handles information under its own terms and privacy policy." },
        {
          type: "ul",
          items: [
            "Telegram — identity (the Mini App launch data), the bot, your channels and the files in them, and the delivery of files when a link is opened. Telegram's own privacy policy applies to everything that happens inside Telegram. The Mini App loads Telegram's web-app script from telegram.org.",
            "Vercel — hosts the Onfile web application and its server functions, and may process technical request data (such as IP addresses) in its infrastructure.",
            `${dbProvider} — stores Onfile's database: accounts, channels, file and playlist records, wallet records, reports and notifications.`,
            "DBByte — object storage and CDN for thumbnail images only.",
          ],
        },
        {
          type: "p",
          text: "At the time of writing, Onfile does not load any third-party analytics or advertising SDK in the app. The \"advertisement\" step before a file is a timed step shown inside Onfile. If third-party advertising or analytics services are added, this page will be updated.",
        },
      ],
    },
    {
      id: "file-access-and-delivery",
      title: "File Access & Delivery",
      blocks: [
        { type: "p", text: "How a file reaches a viewer:" },
        {
          type: "ol",
          items: [
            "The viewer opens a shared Onfile link. The page shows the title, description, type, size, thumbnail, view/download counts and the creator's display name and photo. No sign-in is required to see it.",
            "The viewer completes the access step: a short timed advertisement step, or the password if the creator set one.",
            "Onfile's server checks the request (including the password, if any) and only then returns the Telegram link of the post.",
            "The viewer taps Open in Telegram. Telegram — not Onfile — opens the post and delivers the file, subject to Telegram's own rules. Access to a post in a private channel is controlled by Telegram.",
          ],
        },
        { type: "p", text: "The Telegram link is not included in the public page data and is revealed only by the server after the access step succeeds. Original files are never served from Onfile's servers." },
      ],
    },
    {
      id: "cookies",
      title: "Cookies and Similar Technologies",
      blocks: [
        { type: "p", text: "Onfile uses a small number of cookies and browser-storage entries needed for the app to work. It does not use advertising or cross-site tracking cookies." },
        {
          type: "ul",
          items: [
            "onfile_session — a secure, HTTP-only cookie holding a random session token that keeps you signed in (30 days). Only a hash of the token is stored on the server.",
            "onfile_setup — a short-lived cookie used only while a channel connection is being set up.",
            "Browser storage on your device: your theme choice, whether you completed the welcome screens, items you saved from shared pages (kept on your device only), a draft of a file you are publishing, and temporary state for an in-progress channel connection or playlist navigation.",
          ],
        },
      ],
    },
    {
      id: "data-sharing",
      title: "Data Sharing",
      blocks: [
        { type: "p", text: "Onfile shares information only as needed to run the service:" },
        {
          type: "ul",
          items: [
            "Publicly, on shared file and playlist pages: the creator's display name, username and Telegram photo, plus file details and thumbnails.",
            "With the service providers listed above, to host, store and deliver the service.",
            "With Telegram, as part of using Telegram features such as the bot and channel verification.",
            "Where required by law or to protect the rights and safety of users, the public or Onfile.",
          ],
        },
        { type: "p", text: "Other users cannot view your private account information, such as your balances, withdrawals or notifications; these are only returned to your signed-in session." },
      ],
    },
    {
      id: "data-retention",
      title: "Data Retention",
      blocks: [
        {
          type: "p",
          text: "Onfile keeps account, channel, file, playlist and wallet records for as long as the account and the service need them. Some data is limited automatically: login sessions expire after 30 days; only a recent set of notifications is kept for each account; temporary channel-connection requests expire after a short window.",
        },
        {
          type: "p",
          text: "Onfile does not currently publish a fixed schedule for deleting other data. Records such as withdrawals and reports may be kept where needed for security, dispute handling or legal reasons. Data held by Telegram, Vercel, the database provider and DBByte is kept according to their own policies.",
        },
      ],
    },
    {
      id: "account-security",
      title: "Account Security",
      blocks: [
        { type: "p", text: "Measures present in the application:" },
        {
          type: "ul",
          items: [
            "Sign-in relies on Telegram's signed launch data, which the server verifies; client-supplied identity is never trusted.",
            "Sessions use random tokens in HTTP-only cookies; only token hashes are stored.",
            "Requests that change data are generally checked to come from the app's own origin, and the server checks that you own the account, file, playlist or channel you are changing.",
            "Rate limits slow down repeated login, unlock, report and withdrawal attempts.",
            "File passwords are stored as hashes.",
            "Secrets such as the bot token and database credentials are kept on the server and are not sent to the app.",
            "Withdrawals are validated on the server and processed as a single all-or-nothing database operation.",
          ],
        },
        {
          type: "note",
          text: "No system is perfectly secure, and Onfile has not been independently certified or audited. We do not claim any security certification.",
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
            "Keep your Telegram account secure (for example with Telegram's two-step verification) and do not share access to it.",
            "Only share files you have the right to share, and only connect channels you own.",
            "Double-check wallet addresses and networks before requesting a withdrawal.",
            "Do not put sensitive personal information in titles, descriptions or thumbnails, which can be seen by people who open your link.",
            "Keep file passwords private and share them only with the people you intend.",
          ],
        },
      ],
    },
    {
      id: "account-deletion",
      title: "Account Deletion & Data Removal",
      blocks: [
        { type: "p", text: "Things you can do yourself inside Onfile:" },
        {
          type: "ul",
          items: [
            "Delete a file (removes the Onfile record, link and thumbnail copy).",
            "Delete a playlist (this does not delete the files in it).",
            "Disconnect a channel in Channel Management.",
            "Edit your display name and username.",
          ],
        },
        {
          type: "p",
          text: `Onfile does not currently have a self-service \"delete my account\" button. To ask for your account or personal data to be deleted, contact ${privacyContact(config)}. Some records may need to be kept where required for security, dispute handling or legal reasons. Content in your Telegram channel is yours and is not deleted by Onfile; you can delete it in Telegram.`,
        },
      ],
    },
    {
      id: "childrens-privacy",
      title: "Children's Privacy",
      blocks: [
        {
          type: "p",
          text: "Onfile is not directed at children, and you must meet Telegram's own minimum age requirement to use Telegram and therefore Onfile. We do not knowingly collect personal information from children below that age. If you believe a child has provided information to Onfile, contact us using the details below and we will look into it.",
        },
      ],
    },
    {
      id: "changes",
      title: "Changes to This Policy",
      blocks: [
        {
          type: "p",
          text: "We may update this page as Onfile changes. The effective date shown at the top shows which version applies. Continuing to use Onfile after an update means you accept the updated policy.",
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
            `Privacy contact: ${privacyContact(config)}`,
          ],
        },
        { type: "p", text: "Onfile does not currently offer live chat or an in-app support desk." },
      ],
    },
  ];
}
