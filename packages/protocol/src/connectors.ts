// Connectors (PLAN.md 5.9): MCP servers that Serai runs or connects to itself on this computer and serves to the
// agents allowed to use them, through its own gateway. Their settings and secrets never leave this computer.
import { type KeyProtection, providerUrlAllowed } from './providers.js';

/** `remote`: a Streamable HTTP endpoint. `local`: a program Serai starts and talks to over stdio. */
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

/** Where an installed connector came from (the install record): Serai's catalog or a registry search. */
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
}

export interface ConnectorsState {
  protection: KeyProtection;
  connectors: ConnectorInfo[];
}

/** Header and variable names a connector's secret may have. */
export const SECRET_NAME = /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/;

/** The same rule as providers: plain http only to this computer, private networks and Tailscale. */
export const connectorUrlAllowed = providerUrlAllowed;
