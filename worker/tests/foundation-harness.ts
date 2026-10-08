import worker from "../index";
export { SoccerBotAccountCoordinator } from "../coordinator";
const harness = {
  async fetch(request: Request, env: Env) {
    const input = (await request.json()) as {
      path?: string;
      method?: string;
      origin?: string;
      host?: string;
      headers?: Record<string, string>;
      vars?: Record<string, unknown>;
      missing?: string;
      foreign?: boolean;
      stalled?: boolean;
    };
    const selected = { ...env };
    for (const [key, value] of Object.entries(input.vars || {}))
      Reflect.set(selected, key, value);
    if (input.missing) Reflect.deleteProperty(selected, input.missing);
    if (input.foreign)
      Reflect.set(selected, "STATE", Reflect.get(env, "FOREIGN"));
    const queries: string[] = [];
    function spy<T extends object>(target: T): T {
      return new Proxy(target, {
        get(object, key) {
          const value: unknown = Reflect.get(object, key);
          if (typeof value !== "function") return value;
          return (...args: unknown[]) => {
            if (key === "prepare") queries.push(String(args[0]));
            const result: unknown = Reflect.apply(value, object, args);
            if (key === "withSession" && result && typeof result === "object")
              return spy(result);
            return result;
          };
        },
      });
    }
    if (selected.STATE) selected.STATE = spy(selected.STATE);
    const method = input.method || "GET";
    const response = await worker.fetch(
      new Request(
        (input.host || "https://soccerbot.test") +
          (input.path || "/api/health"),
        {
          method,
          headers: {
            ...(method !== "GET"
              ? { origin: input.origin || "https://soccerbot.test" }
              : {}),
            ...input.headers,
          },
          ...(input.stalled
            ? {
                body: new ReadableStream({
                  start() {
                    /* Never emits or closes. */
                  },
                }),
              }
            : {}),
        },
      ),
      selected,
    );
    return Response.json({
      status: response.status,
      headers: Object.fromEntries(response.headers),
      body: await response.text(),
      queries,
    });
  },
};

export default harness;
