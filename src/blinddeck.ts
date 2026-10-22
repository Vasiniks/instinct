// JSON-RPC client for the BlindDeck mod (default http://127.0.0.1:12346).
// Calls are serialized: the mod answers one request at a time and actions wait on animations.

export interface Game {
  name: string;
  call<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>;
}

export class RpcError extends Error {
  code: number;
  kind: string;
  constructor(code: number, kind: string, message: string) {
    super(message);
    this.code = code;
    this.kind = kind;
  }
}

export function blindDeck(url: string, timeoutMs = 60_000): Game {
  let id = 0;
  let queue: Promise<unknown> = Promise.resolve();
  const send = async <T>(method: string, params?: Record<string, unknown>): Promise<T> => {
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method, ...(params ? { params } : {}), id: ++id }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      throw new RpcError(-1, "UNREACHABLE", `BlindDeck unreachable at ${url} (is Balatro running with the mod?): ${(e as Error).message}`);
    }
    const body = (await res.json()) as { result?: T; error?: { code: number; message: string; data?: { name?: string } } };
    if (body.error) throw new RpcError(body.error.code, body.error.data?.name ?? "ERROR", `${method}: ${body.error.message}`);
    return body.result as T;
  };
  return {
    name: `blinddeck ${url}`,
    call<T>(method: string, params?: Record<string, unknown>): Promise<T> {
      const next = queue.then(() => send<T>(method, params));
      queue = next.catch(() => undefined);
      return next;
    },
  };
}
