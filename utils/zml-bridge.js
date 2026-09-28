/**
 * amazla/watchplus talks to the phone through a MessageBuilder: request() resolves with
 * `{ result }`. zml's messaging (app.js BaseApp) resolves with the result itself, so
 * this wraps it back. Pure JavaScript, tested in Node.
 */
export function zmlBridge(messaging) {
  return { request: (data) => messaging.request(data).then((result) => ({ result })) }
}
