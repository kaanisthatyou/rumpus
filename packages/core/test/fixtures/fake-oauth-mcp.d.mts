export interface FakeOAuthMcp {
  origin: string;
  url: string;
  log: { registrations: number; tokens: (string | null)[]; calls: { method: string; token: string }[] };
  options: {
    registration: boolean;
    expiresIn: number;
    pkce: boolean;
    issuer?: string;
    deny: boolean;
    resourceMetadata: boolean;
  };
  addClient(id: string, redirectUri: string): void;
  expireAccess(): void;
  endGrants(): void;
  close(): void;
}

export function startFakeOAuthMcp(options?: Partial<FakeOAuthMcp['options']>): Promise<FakeOAuthMcp>;

export function visit(url: string, headers?: Record<string, string>, method?: string): Promise<number>;

export function browse(url: string): Promise<{ status: number; back: string }>;
