export class DurableObject<Env = unknown> {
  constructor(
    readonly ctx: DurableObjectState,
    readonly env: Env,
  ) {}
}

export class WorkerEntrypoint<Env = unknown, Props = unknown> {
  env!: Env;
  ctx!: ExecutionContext;
  props!: Props;
}
