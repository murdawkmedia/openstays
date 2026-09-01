export type ProductionProfileEnvironment = Record<string, string | undefined>;

export function productionProfilePolicy(environment: ProductionProfileEnvironment): {
  production: boolean;
  errors: string[];
};
