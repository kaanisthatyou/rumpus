// The official MCP Registry's server.json (schema 2025-09-29 and later), the parts Rumpus reads, and how an entry
// becomes a connector (PLAN.md 5.9). The curated catalog keeps copies of registry entries in this same shape, so
// a verified entry and a live search result install the same way.
import type { ConnectorInput } from './connectors.js';

export const REGISTRY_URL = 'https://registry.modelcontextprotocol.io';

export interface RegistryInput {
  name?: string;
  description?: string;
  isRequired?: boolean;
  isSecret?: boolean;
  /** May hold `{variable}` placeholders, defined in `variables`. */
  value?: string;
  default?: string;
  choices?: string[];
  /** `boolean` makes a named argument a flag that is on or off. */
  format?: string;
  placeholder?: string;
  variables?: Record<string, RegistryInput>;
}

export interface RegistryArgument extends RegistryInput {
  type: 'positional' | 'named';
  valueHint?: string;
  isRepeated?: boolean;
}

export interface RegistryPackage {
  registryType: string;
  identifier: string;
  version?: string;
  runtimeHint?: string;
  transport?: { type: string };
  runtimeArguments?: RegistryArgument[];
  packageArguments?: RegistryArgument[];
  environmentVariables?: RegistryInput[];
}

export interface RegistryRemote {
  type: string;
  url: string;
  headers?: RegistryInput[];
  variables?: Record<string, RegistryInput>;
}

export interface RegistryServer {
  name: string;
  title?: string;
  description?: string;
  version?: string;
  websiteUrl?: string;
  repository?: { url?: string };
  remotes?: RegistryRemote[];
  packages?: RegistryPackage[];
}

/** A value a person fills in before installing: a key, a token, a folder. */
export interface InstallField {
  key: string;
  label: string;
  description?: string;
  secret: boolean;
  required: boolean;
  default?: string;
  choices?: string[];
  placeholder?: string;
  /** A flag: `true` puts it in the arguments. */
  boolean?: boolean;
}

/** One way to install an entry: its remote address, or one of its packages run through npx, uvx or docker. */
export interface InstallPlan {
  id: string;
  via: 'remote' | 'npm' | 'pypi' | 'oci';
  /** The program that must be on this computer (`npx`, `uvx`, `docker`); none for a remote. */
  runtime?: 'npx' | 'uvx' | 'docker';
  url?: string;
  command?: string;
  /** Arguments; an entry whose placeholders stay empty is left out (with its flag, for a named one). */
  args: { flag?: string; value: string; optional: boolean; env?: boolean; bool?: boolean }[];
  headers: { name: string; value: string; optional: boolean }[];
  env: { name: string; value: string; optional: boolean }[];
  fields: InstallField[];
}

const PLACEHOLDER = /\{([A-Za-z0-9_.-]+)\}/g;

/** Fields an input asks for: its own value when it has none, else the variables in its template. */
function collect(
  input: RegistryInput,
  fallbackKey: string,
  fields: Map<string, InstallField>,
  secretByDefault = false,
): string {
  const template = input.value ?? `{${fallbackKey}}`;
  for (const m of template.matchAll(PLACEHOLDER)) {
    const key = m[1] ?? '';
    if (fields.has(key)) continue;
    // A variable describes itself; a value with no template is the input itself.
    const v = input.variables?.[key];
    const own = input.value === undefined;
    const field: InstallField = {
      key,
      label: key,
      secret: Boolean(v?.isSecret ?? input.isSecret ?? secretByDefault),
      required: Boolean(v?.isRequired ?? input.isRequired),
    };
    const description = v?.description ?? input.description;
    if (description) field.description = description.slice(0, 300);
    const def = v?.default ?? (own ? input.default : undefined);
    if (def !== undefined) field.default = def;
    const choices = v?.choices ?? (own ? input.choices : undefined);
    if (choices?.length) field.choices = choices.slice(0, 50);
    const placeholder = v?.placeholder ?? (own ? input.placeholder : undefined);
    if (placeholder) field.placeholder = placeholder.slice(0, 120);
    fields.set(key, field);
  }
  return template;
}

function argumentsOf(list: RegistryArgument[] | undefined, fields: Map<string, InstallField>): InstallPlan['args'] {
  const out: InstallPlan['args'] = [];
  for (const [i, a] of (list ?? []).entries()) {
    const key = (a.type === 'named' ? a.name?.replace(/^-+/, '') : a.valueHint) || `arg${i + 1}`;
    if (a.type === 'named' && a.format === 'boolean' && a.value === undefined && !fields.has(key)) {
      fields.set(key, {
        key,
        label: a.name ?? key,
        secret: false,
        required: false,
        boolean: true,
        ...(a.description ? { description: a.description.slice(0, 300) } : {}),
        ...(a.default !== undefined ? { default: a.default } : {}),
      });
      out.push({ flag: a.name ?? '', value: `{${key}}`, optional: true, bool: true });
      continue;
    }
    if (a.type === 'named' && a.value === undefined && a.default === undefined && !a.isRequired && !a.description) {
      out.push({ value: a.name ?? '', optional: false }); // a bare flag
      continue;
    }
    const value = collect(
      a.value === undefined && a.default !== undefined ? { ...a, value: a.default } : a,
      key,
      fields,
    );
    out.push({ ...(a.type === 'named' && a.name ? { flag: a.name } : {}), value, optional: !a.isRequired });
  }
  return out;
}

/** Every way an entry can be installed by Rumpus, remote first (nothing to run on this computer). */
export function installPlans(server: RegistryServer): InstallPlan[] {
  const plans: InstallPlan[] = [];
  for (const [i, r] of (server.remotes ?? []).entries()) {
    if (r.type !== 'streamable-http' || typeof r.url !== 'string') continue;
    const fields = new Map<string, InstallField>();
    const url = collect(
      { value: r.url, ...(r.variables ? { variables: r.variables } : {}), isRequired: true },
      'url',
      fields,
    );
    const headers = (r.headers ?? [])
      .filter((h) => h.name)
      .map((h) => ({
        name: h.name ?? '',
        value: collect(h, h.name ?? '', fields, true),
        optional: !h.isRequired,
      }));
    plans.push({ id: `remote:${i}`, via: 'remote', url, args: [], headers, env: [], fields: [...fields.values()] });
  }
  for (const [i, p] of (server.packages ?? []).entries()) {
    if (p.transport?.type && p.transport.type !== 'stdio') continue;
    const via =
      p.registryType === 'npm'
        ? 'npm'
        : p.registryType === 'pypi'
          ? 'pypi'
          : p.registryType === 'oci'
            ? 'oci'
            : undefined;
    if (!via || !p.identifier) continue;
    const fields = new Map<string, InstallField>();
    const env = (p.environmentVariables ?? [])
      .filter((e) => e.name)
      .map((e) => ({ name: e.name ?? '', value: collect(e, e.name ?? '', fields), optional: !e.isRequired }));
    // For docker, `-e NAME={value}` becomes a sealed variable that docker passes on by name: the value never
    // sits in the arguments (which are stored in the clear and visible in the process list).
    let runtimeList = p.runtimeArguments;
    if (via === 'oci') {
      runtimeList = [];
      for (const a of p.runtimeArguments ?? []) {
        const m =
          a.type === 'named' && a.name === '-e' ? /^([A-Za-z_][A-Za-z0-9_]*)=(.*\{.+\}.*)$/.exec(a.value ?? '') : null;
        if (m)
          env.push({
            name: m[1] ?? '',
            value: collect({ ...a, value: m[2] ?? '' }, m[1] ?? '', fields),
            optional: !a.isRequired,
          });
        else runtimeList.push(a);
      }
    }
    const runtimeArgs = argumentsOf(runtimeList, fields);
    const packageArgs = argumentsOf(p.packageArguments, fields);
    const fixed = (value: string) => ({ value, optional: false });
    let command: string;
    let args: InstallPlan['args'];
    let runtime: InstallPlan['runtime'];
    if (via === 'npm') {
      runtime = 'npx';
      command = 'npx';
      args = [
        fixed('-y'),
        ...runtimeArgs,
        fixed(p.version ? `${p.identifier}@${p.version}` : p.identifier),
        ...packageArgs,
      ];
    } else if (via === 'pypi') {
      runtime = 'uvx';
      command = 'uvx';
      args = [...runtimeArgs, fixed(p.version ? `${p.identifier}@${p.version}` : p.identifier), ...packageArgs];
    } else {
      runtime = 'docker';
      command = 'docker';
      // Variables reach the container by name: docker reads their values from its own environment.
      const passEnv = env.map((e) => ({ flag: '-e', value: e.name, optional: e.optional, env: true }));
      args = [
        fixed('run'),
        fixed('-i'),
        fixed('--rm'),
        ...runtimeArgs,
        ...passEnv,
        fixed(p.identifier),
        ...packageArgs,
      ];
    }
    plans.push({ id: `${via}:${i}`, via, runtime, command, args, headers: [], env, fields: [...fields.values()] });
  }
  return plans;
}

function fill(template: string, values: Record<string, string>): { text: string; empty: boolean } {
  let empty = false;
  const text = template.replace(PLACEHOLDER, (_, key: string) => {
    const v = values[key]?.trim() ?? '';
    if (!v) empty = true;
    return v;
  });
  return { text, empty };
}

/** The fields a plan still needs: required ones left empty. */
export function missingFields(plan: InstallPlan, values: Record<string, string>): string[] {
  return plan.fields.filter((f) => f.required && !(values[f.key] ?? f.default ?? '').trim()).map((f) => f.key);
}

/**
 * A connector from a plan and the values a person gave. An `Authorization` value without a scheme gets `Bearer`
 * in front, which is what remote servers expect of a bare key.
 */
export function connectorFromPlan(
  plan: InstallPlan,
  values: Record<string, string>,
  base: { name: string; agents: string[]; source: ConnectorInput['source'] },
): ConnectorInput {
  const all: Record<string, string> = {};
  for (const f of plan.fields) all[f.key] = (values[f.key] ?? f.default ?? '').trim();
  const secrets: { name: string; value: string }[] = [];
  for (const h of plan.headers) {
    const { text, empty } = fill(h.value, all);
    if (empty && h.optional) continue;
    const value = /^authorization$/i.test(h.name) && text && !/\s/.test(text) ? `Bearer ${text}` : text;
    if (value) secrets.push({ name: h.name, value });
  }
  for (const e of plan.env) {
    const { text, empty } = fill(e.value, all);
    if ((empty && e.optional) || !text) continue;
    secrets.push({ name: e.name, value: text });
  }
  const args: string[] = [];
  for (const a of plan.args) {
    const { text, empty } = fill(a.value, all);
    if (a.bool) {
      if (text === 'true' && a.flag) args.push(a.flag);
      continue;
    }
    if (empty && a.optional) continue;
    if (a.env && !secrets.some((s) => s.name === text)) continue;
    if (a.flag) args.push(a.flag);
    args.push(text);
  }
  return {
    name: base.name,
    kind: plan.via === 'remote' ? 'remote' : 'local',
    ...(plan.via === 'remote' ? { url: fill(plan.url ?? '', all).text } : { command: plan.command ?? '', args }),
    secrets,
    agents: base.agents,
    ...(base.source ? { source: base.source } : {}),
  };
}

/** A registry answer, kept to the expected shape (it is someone else's data). */
export function readRegistryServer(raw: unknown): RegistryServer | undefined {
  const s = raw as RegistryServer | undefined;
  if (!s || typeof s !== 'object' || typeof s.name !== 'string' || !s.name || s.name.length > 200) return undefined;
  const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : undefined);
  const input = (i: RegistryInput): RegistryInput => ({
    ...(str(i?.name, 100) ? { name: str(i.name, 100) } : {}),
    ...(str(i?.description, 500) ? { description: str(i.description, 500) } : {}),
    ...(i?.isRequired === true ? { isRequired: true } : {}),
    ...(i?.isSecret === true ? { isSecret: true } : {}),
    ...(str(i?.value, 2000) !== undefined ? { value: str(i.value, 2000) } : {}),
    ...(str(i?.default, 2000) !== undefined ? { default: str(i.default, 2000) } : {}),
    ...(Array.isArray(i?.choices) ? { choices: i.choices.filter((c) => typeof c === 'string').slice(0, 50) } : {}),
    ...(str(i?.format, 30) ? { format: str(i.format, 30) } : {}),
    ...(str(i?.placeholder, 120) ? { placeholder: str(i.placeholder, 120) } : {}),
    ...(i?.variables && typeof i.variables === 'object'
      ? {
          variables: Object.fromEntries(
            Object.entries(i.variables)
              .slice(0, 20)
              .map(([k, v]) => [k.slice(0, 64), input(v)]),
          ),
        }
      : {}),
  });
  const arg = (a: RegistryArgument): RegistryArgument => ({
    ...input(a),
    type: a?.type === 'named' ? 'named' : 'positional',
    ...(str(a?.valueHint, 100) ? { valueHint: str(a.valueHint, 100) } : {}),
    ...(a?.isRepeated === true ? { isRepeated: true } : {}),
  });
  const list = <T>(v: unknown, max: number) => (Array.isArray(v) ? (v.slice(0, max) as T[]) : []);
  const out: RegistryServer = { name: s.name };
  for (const k of ['title', 'version', 'websiteUrl'] as const) {
    const v = str(s[k], 300);
    if (v) out[k] = v;
  }
  const description = str(s.description, 1000);
  if (description) out.description = description;
  const repo = str(s.repository?.url, 300);
  if (repo) out.repository = { url: repo };
  out.remotes = list<RegistryRemote>(s.remotes, 10)
    .filter((r) => typeof r?.type === 'string' && typeof r.url === 'string' && r.url.length < 2000)
    .map((r) => ({
      type: r.type,
      url: r.url,
      headers: list<RegistryInput>(r.headers, 20).map(input),
      ...(r.variables && typeof r.variables === 'object'
        ? { variables: input({ variables: r.variables }).variables ?? {} }
        : {}),
    }));
  out.packages = list<RegistryPackage>(s.packages, 10)
    .filter((p) => typeof p?.registryType === 'string' && typeof p.identifier === 'string' && p.identifier.length < 500)
    .map((p) => ({
      registryType: p.registryType,
      identifier: p.identifier,
      ...(str(p.version, 100) ? { version: str(p.version, 100) } : {}),
      ...(str(p.runtimeHint, 50) ? { runtimeHint: str(p.runtimeHint, 50) } : {}),
      ...(typeof p.transport?.type === 'string' ? { transport: { type: p.transport.type } } : {}),
      runtimeArguments: list<RegistryArgument>(p.runtimeArguments, 30).map(arg),
      packageArguments: list<RegistryArgument>(p.packageArguments, 30).map(arg),
      environmentVariables: list<RegistryInput>(p.environmentVariables, 30).map(input),
    }));
  return out;
}
