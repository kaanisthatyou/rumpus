// People as the workspace shows them: the name they go by, their picture, their color and their roles.
import {
  EMPTY_PROFILE,
  type ImageRef,
  type MemberRole,
  NAME_COLORS,
  type Profile,
  type RoleTag,
  type Settings,
  type WorkspaceState,
} from '@lonca/protocol';
import { Avatar } from '@lonca/ui';
import {
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useMedia } from '../media';
import { useApp } from '../store';
import { firstFrame, PICTURE_TYPES, type PictureShape, readPicture } from './pictures';

export interface Person {
  id: string;
  name: string;
  me: boolean;
  profile: Profile;
  /** The permission level, in a team workspace. */
  role?: MemberRole;
  /** The workspace's roles the person carries. */
  roles: RoleTag[];
  online?: boolean;
  /** The color the name is written in: the person's own, else their first role's; empty for none. */
  color: string;
}

const NO_ROLES: RoleTag[] = [];

/** A person by their device id; `name` is what to call them when the workspace does not know them (any more). */
export function personOf(
  ws: WorkspaceState | undefined,
  settings: Settings | undefined,
  id: string,
  name = '',
): Person {
  const me = Boolean(ws && ws.me.id === id);
  const member = ws?.members?.find((m) => m.device === id);
  const profile = me && settings ? settings.profile : (member?.profile ?? EMPTY_PROFILE);
  const roles = member?.roles?.length
    ? (member.roles.map((r) => ws?.roles?.find((x) => x.id === r)).filter(Boolean) as RoleTag[])
    : NO_ROLES;
  return {
    id,
    name: (me ? ws?.me.name : member?.name) || profile.name || name || '?',
    me,
    profile,
    ...(member ? { role: member.role } : {}),
    roles,
    ...(me ? { online: true } : member?.online !== undefined ? { online: member.online } : {}),
    color: profile.color || roles.find((r) => r.color)?.color || '',
  };
}

export function usePerson(id: string, name?: string): Person {
  const ws = useApp((s) => s.workspace);
  const settings = useApp((s) => s.settings);
  return useMemo(() => personOf(ws, settings, id, name), [ws, settings, id, name]);
}

/** A stored picture as a data URL, asked for from the core the first time it is shown. */
export function usePicture(image: ImageRef | null | undefined): string | undefined {
  const blob = image?.blob;
  const url = useApp((s) => (blob ? s.faces[blob] : undefined));
  useEffect(() => {
    if (blob && !url) void useApp.getState().loadFace(blob);
  }, [blob, url]);
  return url;
}

/** First frames of pictures that move, by blob: made once per window. */
const stills = new Map<string, string>();

/**
 * What to show for a picture: itself, or, when it moves, its first frame until `play` says otherwise. With
 * reduced motion it never plays.
 */
export function useFace(image: ImageRef | null | undefined, play: boolean): string | undefined {
  const url = usePicture(image);
  const blob = image?.blob;
  const animated = Boolean(image?.animated);
  const [still, setStill] = useState(() => (blob ? stills.get(blob) : undefined));
  const calm = useMedia('(prefers-reduced-motion: reduce)');
  const reduced = useApp((s) => s.settings?.motion === 'reduced') || calm;
  useEffect(() => {
    if (!animated || !blob || !url) return;
    const known = stills.get(blob);
    if (known) {
      setStill(known);
      return;
    }
    let live = true;
    void firstFrame(url).then((frame) => {
      if (!frame) return;
      stills.set(blob, frame);
      if (live) setStill(frame);
    });
    return () => {
      live = false;
    };
  }, [animated, blob, url]);
  if (!animated) return url;
  return play && !reduced ? url : still;
}

/** A person's avatar: their picture when they have one. One that moves plays while it is pointed at. */
export function PersonAvatar({
  id,
  name,
  size = 32,
  presence,
  play,
}: {
  id: string;
  name?: string;
  size?: number;
  presence?: 'on' | 'busy' | 'off';
  /** Plays a moving picture whatever the pointer does (an open profile). */
  play?: boolean;
}) {
  const person = usePerson(id, name);
  return <ProfileAvatar profile={person.profile} name={person.name} size={size} presence={presence} play={play} />;
}

export function ProfileAvatar({
  profile,
  name,
  size = 32,
  presence,
  play,
}: {
  profile: Profile;
  name: string;
  size?: number;
  presence?: 'on' | 'busy' | 'off' | undefined;
  play?: boolean | undefined;
}) {
  const [over, setOver] = useState(false);
  const src = useFace(profile.avatar, play ?? over);
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the pointer only starts a moving picture; nothing to operate
    <span className="face" onMouseEnter={() => setOver(true)} onMouseLeave={() => setOver(false)}>
      <Avatar name={name} size={size} src={src} {...(presence ? { presence } : {})} />
    </span>
  );
}

/** The style that writes a name in its color (softened toward the text color, so it reads in both themes). */
export function nameStyle(color: string): CSSProperties | undefined {
  return color ? ({ '--name': color } as CSSProperties) : undefined;
}

/** Opens a person's profile card next to what was clicked. */
export function openProfile(id: string, e: MouseEvent<HTMLElement>, name?: string): void {
  const r = e.currentTarget.getBoundingClientRect();
  useApp.setState({
    profileCard: { id, x: r.right + 10, left: r.left - 10, y: r.top, ...(name ? { name } : {}) },
  });
}

/** A button around a person's avatar or name that opens their profile card. */
export function PersonButton({
  id,
  name,
  className,
  children,
}: {
  id: string;
  name: string;
  className?: string;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      className={`person ${className ?? ''}`}
      aria-label={t('profile.open', { name })}
      title={t('profile.open', { name })}
      onClick={(e) => openProfile(id, e, name)}
    >
      {children}
    </button>
  );
}

/** A workspace's icon: its picture, else the first two letters of its name. */
export function WorkspaceIcon({ name, icon }: { name: string; icon?: ImageRef | undefined }) {
  const [over, setOver] = useState(false);
  const src = useFace(icon, over);
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the pointer only starts a moving picture; nothing to operate
    <span className="wsicon" onMouseEnter={() => setOver(true)} onMouseLeave={() => setOver(false)}>
      {src ? <img src={src} alt="" draggable={false} /> : name.slice(0, 2)}
    </span>
  );
}

/** A role as a small chip: a dot in its color and its name. */
export function RoleChip({ role }: { role: RoleTag }) {
  return (
    <span className="rolechip" style={nameStyle(role.color)}>
      <span className="rolechip__dot" aria-hidden="true" />
      {role.name}
    </span>
  );
}

/** Color swatches as radios, with "none" and any other color through the system's picker. */
export function ColorPick({
  label,
  value,
  onChange,
  none,
}: {
  label: string;
  value: string;
  onChange: (color: string) => void;
  /** The label of the "no color" choice; left out, a color is always chosen. */
  none?: string;
}) {
  const { t } = useTranslation();
  const group = useId();
  const custom = value !== '' && !(NAME_COLORS as readonly string[]).includes(value);
  return (
    <fieldset className="colors">
      <legend className="l-sr">{label}</legend>
      {none !== undefined && (
        <label className="colors__swatch colors__swatch--none" title={none}>
          <input
            type="radio"
            className="l-sr"
            name={group}
            aria-label={`${label}: ${none}`}
            checked={value === ''}
            onChange={() => onChange('')}
          />
          {value === '' && <span className="colors__ring" />}
        </label>
      )}
      {NAME_COLORS.map((color) => (
        <label key={color} className="colors__swatch" style={{ background: color }} title={color}>
          <input
            type="radio"
            className="l-sr"
            name={group}
            aria-label={`${label}: ${color}`}
            checked={value === color}
            onChange={() => onChange(color)}
          />
          {value === color && <span className="colors__ring" />}
        </label>
      ))}
      <label
        className="colors__swatch colors__swatch--custom"
        style={custom ? { background: value } : undefined}
        title={t('profile.colorCustom')}
      >
        <input
          type="color"
          className="l-sr"
          aria-label={`${label}: ${t('profile.colorCustom')}`}
          value={custom ? value : '#8b8d98'}
          onChange={(e) => onChange(e.target.value.toLowerCase())}
        />
        {custom && <span className="colors__ring" />}
      </label>
    </fieldset>
  );
}

/** "Choose" and "Remove" for one picture; `onPick` gets the picture as a data URL, or null to take it away. */
export function PicturePick({
  label,
  shape,
  has,
  onPick,
}: {
  label: string;
  shape: PictureShape;
  has: boolean;
  onPick: (data: string | null) => Promise<void> | void;
}) {
  const { t } = useTranslation();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="picpick">
      <span className="picpick__label">{label}</span>
      <label className={`l-btn l-btn--sm picpick__choose ${busy ? 'is-busy' : ''}`}>
        <input
          ref={input}
          type="file"
          className="l-sr"
          accept={PICTURE_TYPES}
          aria-label={`${label}: ${t('profile.choose')}`}
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (!file) return;
            setBusy(true);
            try {
              await onPick(await readPicture(file, shape));
            } catch {
              useApp.setState({ error: 'picture_type' });
            } finally {
              setBusy(false);
            }
          }}
        />
        {t('profile.choose')}
      </label>
      {has && (
        <button type="button" className="l-btn l-btn--sm l-btn--quiet" onClick={() => void onPick(null)}>
          {t('profile.remove')}
        </button>
      )}
    </div>
  );
}
