// Connectors (PLAN.md 5.9): MCP servers that Rumpus runs or connects to itself on this computer and serves to the
// agents allowed to use them, through its own gateway. Their settings and secrets never leave this computer.
import { type KeyProtection, providerUrlAllowed } from './providers.js';

/** `remote`: a Streamable HTTP endpoint. `local`: a program Rumpus starts and talks to over stdio. */
export const CONNECTOR_KINDS = ['remote', 'local'] as const;
export type ConnectorKind = (typeof CONNECTOR_KINDS)[number];

/**
 * What happens when an agent calls a connector's tool: it runs, it waits for a person each time, it waits for a
 * person once per job, or the agent does not see it at all. Others' requests never run a tool unasked.
 */
export const TOOL_POLICIES = ['allow', 'ask', 'once', 'blocked'] as const;
export type ToolPolicy = (typeof TOOL_POLICIES)[number];

export interface ConnectorTool {
  name: string;
  title?: string;
  description: string;
  /** The server says the tool only reads (`readOnlyHint`); such tools start as `allow`, others as `ask`. */
  readOnly: boolean;
  policy: ToolPolicy;
}

/** A header (remote) or environment variable (local) whose value is sealed; the page sees its last characters. */
export interface ConnectorSecret {
  name: string;
  hint: string;
}

/**
 * A remote connector's sign-in in the browser (OAuth, as MCP servers ask for it). The tokens are sealed on this
 * computer and never shown; the page sees only where the sign-in stands.
 */
export interface ConnectorOAuth {
  /** `needed`: the server asks for a sign-in. `waiting`: the browser is open for one. `signed_in`: tokens are kept. */
  state: 'needed' | 'waiting' | 'signed_in';
  /** The authorization server the sign-in went to, as the connector's own address named it. */
  issuer?: string;
  /** Why the last sign-in did not finish: an error code, and the server's own words. */
  error?: string;
  detail?: string;
  /** A client id entered by hand, for services that do not register apps themselves. */
  clientId?: string;
}

/** Where an installed connector came from (the install record): Rumpus's catalog or a registry search. */
export interface ConnectorSource {
  from: 'catalog' | 'registry';
  /** The entry's name in the official MCP Registry, `io.github.owner/server`. */
  name: string;
  version?: string;
  via: 'remote' | 'npm' | 'pypi' | 'oci';
}

export interface ConnectorInfo {
  id: string;
  name: string;
  /** The prefix of its tools as agents see them (`github__create_issue`). */
  slug: string;
  kind: ConnectorKind;
  url?: string;
  command?: string;
  args?: string[];
  secrets: ConnectorSecret[];
  /** The agents (of any workspace on this computer) that may use it. */
  agents: string[];
  tools: ConnectorTool[];
  /** The last test or start: `ok`, or an error code with the server's own text; `testing` while it runs. */
  state: 'untested' | 'testing' | 'ok' | 'failed';
  error?: string;
  detail?: string;
  server?: { name: string; version?: string };
  source?: ConnectorSource;
  /** Present once the server asked for a sign-in or a client id was entered. */
  oauth?: ConnectorOAuth;
  tested?: number;
  added: number;
}

export interface ConnectorInput {
  id?: string;
  name: string;
  kind: ConnectorKind;
  url?: string;
  command?: string;
  args?: string[];
  /** Values to set; an empty value removes that secret, names not given keep theirs. */
  secrets?: { name: string; value: string }[];
  agents?: string[];
  /** Kept from the first install; a later edit by hand does not change it. */
  source?: ConnectorSource;
  /**
   * For a remote server that signs in with OAuth but does not register apps itself: the client id made at the
   * service for the redirect address `OAUTH_REDIRECT_URI`. Empty removes it; not given keeps it.
   */
  clientId?: string;
}

export interface ConnectorsState {
  protection: KeyProtection;
  connectors: ConnectorInfo[];
}

/**
 * The redirect address of a client id entered by hand: a fixed port on this computer, so it can be registered once
 * at the service. Clients the app registers itself use any free port.
 */
export const OAUTH_REDIRECT_PORT = 47650;
export const OAUTH_REDIRECT_URI = `http://127.0.0.1:${OAUTH_REDIRECT_PORT}/callback`;

/** Header and variable names a connector's secret may have. */
export const SECRET_NAME = /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/;

/** The same rule as providers: plain http only to this computer, private networks and Tailscale. */
export const connectorUrlAllowed = providerUrlAllowed;
