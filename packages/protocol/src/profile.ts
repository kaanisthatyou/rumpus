// What a person, a workspace and a role look like (PLAN.md 5.19): names with a limit, pictures, colors.
import { z } from 'zod';

/** How long the things people name and write about themselves may be. One place, so the UI can count down. */
export const LIMITS = {
  personName: 40,
  pronouns: 24,
  status: 60,
  bio: 190,
  workspaceName: 40,
  workspaceAbout: 240,
  channelName: 40,
  agentName: 40,
  roleName: 24,
  /** Roles a workspace may have, and roles one member may carry. */
  roles: 24,
  memberRoles: 6,
  /** Characters of one message. */
  message: 20_000,
  /** Bytes of a picture (an avatar, a banner, a workspace's icon), animated ones included. */
  picture: 2 * 1024 * 1024,
} as const;

const HEX = /^#[0-9a-f]{6}$/;
export const isHexColor = (value: unknown): value is string => typeof value === 'string' && HEX.test(value);

/** Name colors offered as swatches; any other `#rrggbb` can be picked too. */
export const NAME_COLORS = [
  '#e5484d',
  '#f76b15',
  '#e2a336',
  '#46a758',
  '#12a594',
  '#3e9bdc',
  '#6e6ade',
  '#ab4aba',
  '#e93d82',
  '#8b8d98',
] as const;

/** A picture in the content-addressed store: the file's name is the hash of its bytes. */
export const ImageRefSchema = z.object({
  blob: z.string().regex(/^[a-f0-9]{64}\.(png|jpg|webp|gif)$/),
  mime: z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/gif']),
  /** It moves (a GIF, an animated WebP): shown still until it is pointed at. */
  animated: z.boolean().optional(),
});
export type ImageRef = z.infer<typeof ImageRefSchema>;

/** The profile's fields as they are checked; the stored settings fill in the newer ones from defaults. */
export const PROFILE_FIELDS = {
  name: z.string().trim().max(LIMITS.personName),
  pronouns: z.string().trim().max(LIMITS.pronouns),
  /** A line next to the name: what the person is up to. */
  status: z.string().trim().max(LIMITS.status),
  bio: z.string().max(LIMITS.bio),
  /** The color the name is written in; empty for none. */
  color: z.string().regex(/^(#[0-9a-f]{6})?$/),
  /** Two colors the profile card is drawn in; empty for none. */
  theme: z.array(z.string().regex(HEX)).max(2),
  avatar: ImageRefSchema.nullable(),
  banner: ImageRefSchema.nullable(),
};

export const ProfileSchema = z.object({
  ...PROFILE_FIELDS,
  pronouns: PROFILE_FIELDS.pronouns.default(''),
  status: PROFILE_FIELDS.status.default(''),
  bio: PROFILE_FIELDS.bio.default(''),
  color: PROFILE_FIELDS.color.default(''),
  theme: PROFILE_FIELDS.theme.default([]),
  avatar: PROFILE_FIELDS.avatar.default(null),
  banner: PROFILE_FIELDS.banner.default(null),
});
export type Profile = z.infer<typeof ProfileSchema>;

export const EMPTY_PROFILE: Profile = {
  name: '',
  pronouns: '',
  status: '',
  bio: '',
  color: '',
  theme: [],
  avatar: null,
  banner: null,
};

/** Text as one line: control characters and line breaks become spaces, runs of spaces one. */
export function oneLine(text: string): string {
  return text
    .replace(/[\p{Cc}\u2028\u2029]+/gu, ' ')
    .replace(/ {2,}/g, ' ')
    .trim();
}

/** A profile from anywhere (a peer's event, an old file): what does not check out is dropped, never trusted. */
export function cleanProfile(raw: unknown): Profile {
  const r = (raw ?? {}) as Record<string, unknown>;
  // One line each: a name or a status with line breaks or control characters in it could pass for more than a
  // name where it is shown or handed to an agent.
  const text = (v: unknown, max: number) => (typeof v === 'string' ? oneLine(v).slice(0, max) : '');
  const image = (v: unknown) => {
    const parsed = ImageRefSchema.safeParse(v);
    return parsed.success ? parsed.data : null;
  };
  const theme = Array.isArray(r.theme) ? r.theme.filter(isHexColor).slice(0, 2) : [];
  return {
    name: text(r.name, LIMITS.personName),
    pronouns: text(r.pronouns, LIMITS.pronouns),
    status: text(r.status, LIMITS.status),
    bio: typeof r.bio === 'string' ? r.bio.slice(0, LIMITS.bio) : '',
    color: isHexColor(r.color) ? r.color : '',
    theme: theme.length === 2 ? theme : [],
    avatar: image(r.avatar),
    banner: image(r.banner),
  };
}

/**
 * A role of a workspace in Discord's sense: a name and a color admins give to members. It shows who does what
 * and colors nothing but the name; what a member may do comes from their permission level, never from a role.
 */
export interface RoleTag {
  id: string;
  name: string;
  /** `#rrggbb`, or empty for no color. */
  color: string;
  created: number;
}

export const RoleInputSchema = z.object({
  id: z.string().max(64).optional(),
  name: z.string().trim().min(1).max(LIMITS.roleName),
  color: z
    .string()
    .regex(/^(#[0-9a-f]{6})?$/)
    .default(''),
});
export type RoleInput = z.input<typeof RoleInputSchema>;

/** How a workspace presents itself: its name, a line about it, an icon for the rail and a banner. */
export interface WorkspaceLook {
  name: string;
  about: string;
  icon?: ImageRef;
  banner?: ImageRef;
}

/** Which picture a call sets: a person's avatar or banner, a workspace's icon or banner. */
export const PICTURE_SLOTS = ['avatar', 'banner'] as const;
export type PictureSlot = (typeof PICTURE_SLOTS)[number];
export const WORKSPACE_SLOTS = ['icon', 'banner'] as const;
export type WorkspaceSlot = (typeof WORKSPACE_SLOTS)[number];
