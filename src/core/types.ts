export type Severity = "info" | "warning" | "error";

export type CommandMode = "init" | "doctor" | "check";

export type Diagnostic = {
  ruleId: string;
  severity: Severity;
  message: string;
  path?: string;
  location?: {
    line?: number;
    column?: number;
  };
  target?: string;
  hint?: string;
  source: string;
};

export type Waiver = {
  rule: string;
  target?: string;
  reason: string;
  owner: string;
  expires?: string;
};

export type AdapterSelection =
  | string
  | {
      use: string;
      options?: unknown;
    };

export type EacConfig = {
  project?: {
    name?: string;
  };
  adapters?: AdapterSelection[];
  waivers?: Waiver[];
  agents?: unknown;
  product?: unknown;
  cucumber?: unknown;
  bdd?: unknown;
  versioning?: unknown;
};

export type LoadedConfig = {
  path?: string;
  config: EacConfig;
};

export type Artifact = {
  id: string;
  path: string;
  kind: string;
  source: string;
  required?: boolean;
};

export type GraphNode = {
  id: string;
  kind: string;
  label?: string;
  path?: string;
  source: string;
  data?: Record<string, unknown>;
};

export type GraphEdge = {
  from: string;
  to: string;
  kind: string;
  source: string;
  data?: Record<string, unknown>;
};

export type GraphContribution = {
  nodes?: GraphNode[];
  edges?: GraphEdge[];
};

export type RepoGraph = {
  artifacts: Artifact[];
  nodes: GraphNode[];
  edges: GraphEdge[];
};

export type InitAction = {
  path: string;
  content: string;
  source: string;
  description?: string;
};

export type ResolvedInitAction = InitAction & {
  action: "create" | "overwrite" | "skip";
};

export type Rule = {
  id: string;
  description: string;
  source: string;
  check(ctx: RepoContext): Diagnostic[] | Promise<Diagnostic[]>;
};

export type Adapter = {
  id: string;
  description: string;
  artifacts?(ctx: RepoContext): Artifact[] | Promise<Artifact[]>;
  graph?(ctx: RepoContext): GraphContribution | Promise<GraphContribution>;
  init?(ctx: RepoContext): InitAction[] | Promise<InitAction[]>;
  rules?(ctx: RepoContext): Rule[] | Promise<Rule[]>;
  doctor?(ctx: RepoContext): Diagnostic[] | Promise<Diagnostic[]>;
};

export type EacFileSystem = {
  exists(path: string): boolean;
  readText(path: string): string;
  readJson<T = unknown>(path: string): T;
  writeText(path: string, content: string): void;
};

export type RepoContext = {
  root: string;
  mode: CommandMode;
  configPath?: string;
  config: EacConfig;
  graph: RepoGraph;
  adapterOptions<T = unknown>(adapterId: string): T | undefined;
  resolve(path: string): string;
  fs: EacFileSystem;
};
