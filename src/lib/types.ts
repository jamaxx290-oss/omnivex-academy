/** Shared client-side types mirroring the API responses. */

export type Me = {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  whatsappNumber: string | null;
  country: string | null;
  stateRegion: string | null;
  gender: string | null;
  isAdmin: boolean;
  membershipStatus: "none" | "active" | "revoked";
  membershipExpiresAt: string | null;
  banned: boolean;
  createdAt: string | null;
  unreadNotifications: number;
};

export type PublicSettings = {
  appName: string;
  priceKobo: number | null;
  currency: string;
  termsText: string;
  termsVersion: number;
  pushPublicKey: string | null;
};

export type ReplyPreview = {
  id: string;
  senderId: string;
  senderName: string;
  body: string | null;
  type: string;
  mediaUrl: string | null;
  deleted: boolean;
} | null;

export type ChatMessage = {
  id: string;
  scope: "group" | "dm";
  groupId: string | null;
  conversationId: string | null;
  senderId: string;
  senderName: string;
  type: "text" | "image" | "video" | "audio";
  body: string | null;
  mediaPath: string | null;
  mediaUrl: string | null;
  mediaMime: string | null;
  durationMs: number | null;
  replyToId: string | null;
  replyTo: ReplyPreview;
  createdAt: string;
  deleted: boolean;
};

export type GroupSummary = {
  id: string;
  name: string;
  description: string | null;
  pictureUrl: string | null;
  sendPolicy: "everyone" | "admins_only";
  joinPolicy: "open" | "request";
  role: "member" | "admin" | null;
  isMember: boolean;
  joinRequest: "none" | "pending" | "approved" | "denied";
  memberCount: number;
  unread: number;
  lastMessage: {
    body: string;
    senderName: string;
    type: string;
    at: string;
  } | null;
};

export type GroupDetail = {
  id: string;
  name: string;
  description: string | null;
  pictureUrl: string | null;
  sendPolicy: "everyone" | "admins_only";
  joinPolicy: "open" | "request";
  members: { id: string; name: string; role: string }[];
  myRole: string;
  canSend: boolean;
  isMember: boolean;
  joinRequest: "none" | "pending" | "approved" | "denied";
};

export type GroupJoinRequest = {
  id: string;
  groupId: string;
  userId: string;
  userName: string;
  userEmail: string;
  status: "pending" | "approved" | "denied";
  createdAt: string;
};

export type Conversation = {
  id: string;
  partnerId: string;
  partnerName: string;
  unread: number;
  lastMessage: {
    body: string;
    type: string;
    at: string;
    mine: boolean;
  } | null;
};

export type AppNotification = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  read: boolean;
  createdAt: string;
};

export type MemberRow = {
  id: string;
  name: string;
  email: string;
  whatsappNumber: string | null;
  country: string | null;
  stateRegion: string | null;
  gender: string | null;
  emailVerified: boolean;
  isAdmin: boolean;
  membershipStatus: string;
  membershipExpiresAt: string | null;
  banned: boolean;
  createdAt: string;
};

export type AdminGroupRow = {
  id: string;
  name: string;
  description: string | null;
  pictureUrl: string | null;
  sendPolicy: "everyone" | "admins_only";
  joinPolicy: "open" | "request";
  archived: boolean;
  createdAt: string;
  messageCount: number;
  pendingRequests: number;
  members: { id: string; name: string; role: string }[];
};

export type PaymentRow = {
  id: string;
  reference: string;
  userId: string;
  userName: string;
  userEmail: string;
  amountKobo: number;
  currency: string;
  status: string;
  channel: string | null;
  termsVersion: number | null;
  createdAt: string;
  verifiedAt: string | null;
};

export type AdminStats = {
  totalMembers: number;
  activeMembers: number;
  verifiedMembers: number;
  payments: {
    total: number;
    success: number;
    pending: number;
    failed: number;
    revenueKobo: number;
  };
  priceKobo: number | null;
  paystackConfigured: boolean;
  groupsCount: number;
  recentSignups: {
    id: string;
    name: string;
    email: string;
    status: string;
    createdAt: string;
  }[];
};

export type NotificationPrefs = {
  push_enabled: boolean;
  inapp_enabled: boolean;
  group_message_push: boolean;
  reply_push: boolean;
  dm_push: boolean;
  announcement_push: boolean;
};

export type Announcement = {
  id: string;
  title: string;
  body: string;
  createdAt: string;
};
