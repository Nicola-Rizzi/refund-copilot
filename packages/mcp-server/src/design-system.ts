// Shared interfaces — no hardcoded data.
// All data is read live from the source repos by loaders.ts.

export interface ApiEndpoint {
  method: string;
  path: string;
  description: string;
  body?: Record<string, string>;
  response: unknown;
}

export interface Token {
  name: string;
  value: string;
  category: "color" | "spacing" | "typography" | "radius" | "shadow";
  description: string;
}

export interface ComponentProp {
  name: string;
  type: string;
  required: boolean;
  default?: string;
}

export interface Component {
  name: string;
  importPath: string;
  props: ComponentProp[];
  example: string;
}

