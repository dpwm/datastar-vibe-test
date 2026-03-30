import { createBrotliCompress, createGzip, constants } from 'node:zlib'
import { Readable, PassThrough, pipeline } from 'node:stream'

// A StatePair bundles shared application state with per-connection view state.
// State is the same for all clients; ViewState is unique to each SSE connection.
export type StatePair<State, ViewState> = {
  state: State,
  viewState: ViewState
}

// A Component defines two rendering functions:
//   render: produces HTML elements for DOM morphing (datastar-patch-elements)
//   signals: produces a JSON signal object for signal patching (datastar-patch-signals)
// Signals prefixed with _ are private (server→client only) and excluded from POST updates
// by the data-on-signal-patch-filter attribute on the client.
export type Component<State extends {}, ViewState extends {viewId: string}> = {
  render: (args: StatePair<State, ViewState>) => string,
  signals: (args: StatePair<State, ViewState>) => string,
}

// Arguments for eventStream: combines state, view state, component methods,
// the event bus, and the original request into a single object.
export type EventStreamArgs<State extends {}, ViewState extends {viewId: string}> =
  StatePair<State, ViewState>
  & Component<State, ViewState>
  & {bus: EventTarget, request: Request};

// Creates an SSE Response that streams datastar-patch-elements and datastar-patch-signals
// events to the client. Subscribes to two EventTarget channels:
//   "*"           — broadcast channel for shared state changes (all clients update)
//   viewId        — per-connection channel for view state changes (single client update)
// On connection, immediately pushes the initial render and signals.
// On cleanup (pipeline close/error), removes event listeners from the bus.
export function eventStream<State extends {}, ViewState extends {viewId: string}>(args: EventStreamArgs<State, ViewState>): Response {
  const acceptEncoding = args.request.headers.get('accept-encoding') ?? ''

  const source = new Readable({ read() {} });
  const passthrough = new PassThrough()

  let contentEncoding: string | undefined
  let compressor: any

  if (acceptEncoding.includes('br')) {
    compressor = createBrotliCompress({
      params: {
        [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_TEXT,
        [constants.BROTLI_PARAM_LGWIN]: 19,
        [constants.BROTLI_PARAM_QUALITY]: 3,
      },
    });
    contentEncoding = 'br'
  } else if (acceptEncoding.includes('gzip')) {
    compressor = createGzip()
    contentEncoding = 'gzip'
  }

  function doUpdate() {
    source.push(`event: datastar-patch-elements\ndata: elements ${args.render(args).replaceAll('\n', '')}\n\n`)
    source.push(`event: datastar-patch-signals\ndata: signals ${args.signals(args).replaceAll('\n', '')}\n\n`)
    compressor?.flush()
  }

  args.bus.addEventListener("*", doUpdate);
  args.bus.addEventListener(args.viewState.viewId, doUpdate);

  function cleanup(err: NodeJS.ErrnoException | null) {
    if (err) console.error(err)
    args.bus.removeEventListener("*", doUpdate);
    args.bus.removeEventListener(args.viewState.viewId, doUpdate);
  }

  compressor ? pipeline(source, compressor, passthrough, cleanup) : pipeline(source, passthrough, cleanup);

  // Push initial render so the client gets the full page immediately
  doUpdate();

  const readableStream = Readable.toWeb(passthrough) as unknown as globalThis.ReadableStream
  const responseHeaders: Record<string, string> = {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    'connection': 'keep-alive',
  }

  if (contentEncoding) {
    responseHeaders['content-encoding'] = contentEncoding
  }

  return new Response(readableStream, {
    headers: responseHeaders,
  })
}
