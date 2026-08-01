import {
  describeError,
  isBackgroundResponse,
  type BackgroundRequest,
  type ResponseFor,
} from "./messages";

/**
 * Send a request to the service worker and always resolve: transport failures
 * (worker asleep, no receiver, malformed reply) come back as `{ ok: false }`
 * so callers have a single error path to render.
 */
export async function sendToBackground<R extends BackgroundRequest>(
  request: R,
): Promise<ResponseFor<R>> {
  try {
    if (typeof chrome === "undefined" || !chrome.runtime?.sendMessage) {
      return { ok: false, type: request.type, error: "chrome.runtime is unavailable" };
    }

    const response: unknown = await chrome.runtime.sendMessage(request);
    if (!isBackgroundResponse(response)) {
      return { ok: false, type: request.type, error: "Malformed background response" };
    }

    return response as ResponseFor<R>;
  } catch (error) {
    return { ok: false, type: request.type, error: describeError(error) };
  }
}
