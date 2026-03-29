import { Elysia, t } from "elysia";
import { html, Html } from '@elysiajs/html'
import { staticPlugin } from '@elysiajs/static'
import { createBrotliCompress, createGzip, constants } from 'node:zlib'
import { Readable, PassThrough, pipeline } from 'node:stream'
import { randomBytes } from 'node:crypto'


const state = {numbers: new Array(64).fill(0), count: 0};

type ViewState = {viewId: string, color?: "green" | "red"}
const viewStates = new Map<string, ViewState>()

function getViewState(viewId: string): ViewState {
   return viewStates.getOrInsert(viewId, {viewId});
}

function signals({state}: {state: {count: number}}): string {
  return `{"_count": ${state.count}}`
}

function Render({state, viewState}: {state: {numbers: number[], count: number}, viewState: ViewState}): string {
  viewState.color ??= 'green';
  return (
    <div id="grid" data-signals:view-id={`'${viewState.viewId}'`} data-on-signal-patch-filter='{"exclude": /^_.*/}' data-on-signal-patch="@post('/update')">
    <div data-init="@get('/stream')" class="grid grid-cols-8 gap-1 w-64" data-effect="history.replaceState(null, '', `?n=${$_count}`)">
      {Array.from({ length: 64 }, (_, i) => (
	<div
	  id={`cell-${i}`}
	  class={`flex items-center justify-center aspect-square border border-gray-300 rounded text-sm bg-${viewState.color}-300`}
	>
	  {state.numbers[i]}
	</div>
      ))}
    </div>
      <button data-on:click="$color = 'red'">Red</button>
    </div>) as string;
}

const bus = new EventTarget();

type StatePair<State, ViewState> = {
  state: State,
  viewState: ViewState
}

type Component<State extends {}, ViewState extends {viewId: string}> = {
  render: (args: StatePair<State, ViewState>) => string,
  signals: (args: StatePair<State, ViewState>) => string,
}

type EventStreamArgs<State extends {}, ViewState extends {viewId: string}> = StatePair<State, ViewState> & Component<State, ViewState> & {bus: EventTarget, acceptEncoding: string | undefined};

// Don’t store the data on the backend. Leave it on the frontend.
function eventStream<State extends {}, ViewState extends {viewId: string}>(args: EventStreamArgs<State, ViewState>): Response {
  args.acceptEncoding ??= '';

  const source = new Readable({ read() {} });
  const passthrough = new PassThrough()

  let contentEncoding: string | undefined
  let compressor: any

  if (args.acceptEncoding.includes('br')) {
    compressor = createBrotliCompress({
      params: {
	[constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_TEXT,
	[constants.BROTLI_PARAM_LGWIN]: 19,
	[constants.BROTLI_PARAM_QUALITY]: 3,
      },
    });
    contentEncoding = 'br'
  } else if (args.acceptEncoding.includes('gzip')) {
    compressor = createGzip()
    contentEncoding = 'gzip'
  }


  function doUpdate() {
    source.push(`event: datastar-patch-elements\ndata: elements ${args.render(args)}\n\n`)
    source.push(`event: datastar-patch-signals\ndata: signals ${args.signals(args)}\n\n`)
    compressor?.flush()
  }



  bus.addEventListener("*", doUpdate);
  bus.addEventListener(args.viewState.viewId, doUpdate);

  function cleanup() {
    bus.removeEventListener("*", doUpdate);
    bus.removeEventListener(args.viewState.viewId, doUpdate);
    console.log("stream closed");
  }

  compressor ? pipeline(source, compressor, passthrough, cleanup) : pipeline(source, passthrough, cleanup);
  console.log("stream opened");

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

const app = new Elysia()
.use(html())
.use(staticPlugin({ assets: 'public' }))
.get("/", () => {
  const viewState = {viewId: randomBytes(20).toBase64({alphabet: 'base64url'})}

  return (
    <html lang="en">
      <head>
	<meta charset="UTF-8" />
	<meta name="viewport" content="width=device-width, initial-scale=1.0" />
	<title>App</title>
	<link rel="stylesheet" href="/public/styles.css" />
	<script type="module" src="https://cdn.jsdelivr.net/gh/starfederation/datastar@1.0.0-RC.8/bundles/datastar.js"></script>
      </head>
      <body>
	<Render state={state} viewState={viewState}/>
      </body>
    </html>
  )})
.get("/stream", ({ headers, query }) => {
  const args = JSON.parse(query.datastar)!;
  const viewState = getViewState(args.viewId)
  // In practice, state would come from database.
  const component = {render: Render, signals}
  const acceptEncoding = headers['accept-encoding']
  Object.assign(viewState, args);
  return eventStream({...component, bus, state, viewState, acceptEncoding})
}, {query: t.Object({datastar: t.String()})})
.post("/update", async ({request}) => {
  const body = await request.json();
  Object.assign(getViewState(body.viewId), body);
  console.log("UPDATE");
  bus.dispatchEvent(new Event(body.viewId));
  return ''
})
.listen({hostname: '0.0.0.0', port: 3000})

function pollUpdate() {
  state.numbers[(Math.random() * 64)|0] = (Math.random() * 100) | 0;
  state.count++;
  // console.log("update");
  bus.dispatchEvent(new CustomEvent("*"));
}
setInterval(pollUpdate, 1000)

console.log(
  `🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`
)
